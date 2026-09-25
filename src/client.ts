import type { Config } from "./config.js";
import { ProofreadError } from "./errors.js";
import { readSseReport } from "./sse.js";
import type { Brief, BriefList, BriefVersion, CheckoutLink, Coverage, CoverageCh, Report, ResolveBatch, ResolveResult, Row, SavedBrief, SignupResult, SuggestAnswer, SuggestDomain, SuggestLang, UpdatedBrief } from "./types.js";

export const USER_AGENT = "proofread-mcp/0.3.0 (+https://github.com/Data-Alchemy-Labs/proofread-mcp)";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_BATCH_CITES = 500;
/** A saved brief's id as it goes into a URL path: letters, digits, hyphens, underscores (no dots, so never `..`). */
export const BRIEF_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** The API's cap on a suggestion query (413 too_large past it). */
export const MAX_SUGGEST_QUERY_CHARS = 20_000;
/** A query longer than this (a pasted paragraph) goes as POST, as the web page sends it; a short one as GET. */
export const SUGGEST_GET_MAX_CHARS = 1_500;
/** ...and so does a short one whose encoded form would make a long URL (many accented characters). */
const SUGGEST_GET_MAX_ENCODED = 4_000;

/** A default check answers in seconds; a deep check runs 1 to 2 s per citation, four in parallel, up to 15 minutes server-side. */
const DEFAULT_TIMEOUT_MS = 120_000;
const DEEP_TIMEOUT_MS = 16 * 60_000;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface VerifyOptions {
  /** Run the support check (opt-in; the clause before each citation is sent to the model judge). */
  deep?: boolean;
  /** Deep mode only: when given, the client reads the SSE stream and reports each finished row. Without it, one JSON is requested. */
  onRow?: (row: Row, report: Report) => void;
  signal?: AbortSignal;
}

export type Plan = "payg" | "solo" | "firm";

export interface SuggestOptions {
  domain?: SuggestDomain;
  /** The answer's language; the API defaults to the query's language. */
  lang?: SuggestLang;
  /** Rows per section, 1 to 50. */
  k?: number;
}

export interface Client {
  verifyText(text: string, options?: VerifyOptions): Promise<Report>;
  verifyFile(bytes: Uint8Array, filename: string, options?: VerifyOptions): Promise<Report>;
  /** One citation string against the register (GET /v1/resolve). Counts against the resolve quota, not the check quota. */
  resolveV1(cite: string, signal?: AbortSignal): Promise<ResolveResult>;
  /** Up to 500 citation strings in one call (POST /v1/resolve); results come back in input order. */
  resolveBatch(cites: string[], signal?: AbortSignal): Promise<ResolveBatch>;
  renderMarkdown(report: Report, signal?: AbortSignal): Promise<string>;
  coverage(signal?: AbortSignal): Promise<Coverage>;
  coverageCh(signal?: AbortSignal): Promise<CoverageCh>;
  /** POST /agent/signup: an account and a key for the owner's inbox. `created` is false when an existing unconfirmed account's key was rotated. */
  signUp(email: string, agentName: string, signal?: AbortSignal): Promise<{ created: boolean; result: SignupResult }>;
  /** POST /agent/checkout-link with the key: a Stripe Checkout page for the owner. */
  checkoutLink(plan: Plan, signal?: AbortSignal): Promise<CheckoutLink>;
  /** POST /v1/briefs: store a brief (opt-in, encrypted in the account) and run the default check on it. */
  saveBrief(text: string, title?: string, signal?: AbortSignal): Promise<SavedBrief>;
  /** GET /v1/briefs: the account's saved briefs. */
  listBriefs(signal?: AbortSignal): Promise<BriefList>;
  /** GET /v1/briefs/{id}: the saved text, the latest report and the versions. */
  getBrief(id: string, signal?: AbortSignal): Promise<Brief>;
  /** PUT /v1/briefs/{id}: a new text and/or title; a changed text (or recheck: true) is re-checked and kept as a new version. */
  updateBrief(id: string, changes: { text?: string; title?: string; recheck?: boolean }, signal?: AbortSignal): Promise<UpdatedBrief>;
  /** GET /v1/briefs/{id}/versions/{v}: one earlier version's text. */
  getBriefVersion(id: string, v: number, signal?: AbortSignal): Promise<BriefVersion>;
  /** DELETE /v1/briefs/{id}: permanent. */
  deleteBrief(id: string, signal?: AbortSignal): Promise<void>;
  /** GET /v1/suggest (POST for a long query): a Swiss statute article -> the leading BGE cited with it. One resolve per answered query. */
  suggest(query: string, options?: SuggestOptions, signal?: AbortSignal): Promise<SuggestAnswer>;
  /** The origin of PROOFREAD_API (https://proofread.law by default): the site that the API's relative links (a suggestion's check_url) point into. */
  siteOrigin(): string;
  hasApiKey(): boolean;
  /** Adopt a key for the rest of this process (after sign_up); nothing is written to disk. */
  setApiKey(key: string): void;
}

export function createClient(config: Config, fetchImpl: FetchLike = globalThis.fetch): Client {
  let apiKey = config.apiKey;

  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/event-stream",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...extra,
  });

  async function call(path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const url = config.baseUrl + path;
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: withTimeout(timeoutMs, signal) });
    } catch (cause) {
      throw ProofreadError.fromFetchFailure(config.baseUrl, cause);
    }
    if (!res.ok) throw ProofreadError.fromBody(res.status, await bodyAsJson(res));
    return res;
  }

  /** The JSON body of a 2xx answer, or a clear error when the body is not JSON (maintenance page, WAF interstitial) or is cut. */
  async function json<T>(res: Response, check?: (value: unknown) => string | undefined): Promise<T> {
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("application/json")) {
      throw new ProofreadError(res.status, "bad_content_type",
        `proofread.law answered HTTP ${res.status} with ${type.split(";")[0] || "no content type"} instead of JSON; the service may be behind a maintenance or challenge page. Try again in a minute.`);
    }
    let value: unknown;
    try {
      value = await res.json();
    } catch (cause) {
      throw ProofreadError.fromFetchFailure(config.baseUrl, cause, true);
    }
    const problem = check?.(value);
    if (problem) throw new ProofreadError(res.status, "bad_shape", `proofread.law answered an unexpected shape (${problem}). Try again; if it persists the API may have changed.`);
    return value as T;
  }

  async function verify(body: string | FormData, contentType: string | undefined, options: VerifyOptions): Promise<Report> {
    const deep = options.deep === true;
    const path = verifyPath(deep, deep && options.onRow !== undefined);
    const res = await call(path, { method: "POST", headers: headers(contentType ? { "Content-Type": contentType } : {}), body },
      deep ? DEEP_TIMEOUT_MS : DEFAULT_TIMEOUT_MS, options.signal);
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("text/event-stream")) {
      if (!res.body) throw new ProofreadError(0, "stream_incomplete", "proofread.law's deep-check stream had no body. Run the check again.");
      try {
        return await readSseReport(res.body, options.onRow);
      } catch (cause) {
        if (cause instanceof ProofreadError) throw cause;
        throw ProofreadError.fromFetchFailure(config.baseUrl, cause, true);
      }
    }
    return json<Report>(res, checkReportShape);
  }

  return {
    verifyText: (text, options = {}) => verify(JSON.stringify({ text }), "application/json", options),

    verifyFile(bytes, filename, options = {}) {
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new ProofreadError(413, "too_large", `${bytes.byteLength} bytes`);
      }
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)]), filename);
      return verify(form, undefined, options); // fetch sets the multipart boundary
    },

    async resolveV1(cite, signal) {
      const res = await call(`/v1/resolve?cite=${encodeURIComponent(cite)}`, { method: "GET", headers: headers() }, DEFAULT_TIMEOUT_MS, signal);
      return json<ResolveResult>(res, (v) => (isObject(v) && typeof v.status === "string" ? undefined : "no status field"));
    },

    async resolveBatch(cites, signal) {
      if (cites.length > MAX_BATCH_CITES) throw new ProofreadError(400, "too_many", `${cites.length} citations; the cap is ${MAX_BATCH_CITES} per call`);
      const res = await call("/v1/resolve", { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ cites }) },
        DEFAULT_TIMEOUT_MS, signal);
      return json<ResolveBatch>(res, (v) => (isObject(v) && Array.isArray(v.results) ? undefined : "no results array"));
    },

    async renderMarkdown(report, signal) {
      const res = await call("/render?format=md", { method: "POST", headers: headers({ "Content-Type": "application/json", Accept: "text/markdown" }),
        body: JSON.stringify(report) }, DEFAULT_TIMEOUT_MS, signal);
      try {
        return await res.text();
      } catch (cause) {
        throw ProofreadError.fromFetchFailure(config.baseUrl, cause, true);
      }
    },

    async coverage(signal) {
      const res = await call("/api/coverage", { method: "GET", headers: headers() }, DEFAULT_TIMEOUT_MS, signal);
      return json<Coverage>(res, (v) => (isObject(v) && typeof v.coverage === "string" ? undefined : "no coverage statement"));
    },

    async coverageCh(signal) {
      const res = await call("/v1/coverage?jurisdiction=ch", { method: "GET", headers: headers() }, DEFAULT_TIMEOUT_MS, signal);
      return json<CoverageCh>(res, (v) => (isObject(v) && typeof v.storage === "string" ? undefined : "no coverage answer"));
    },

    async signUp(email, agentName, signal) {
      const res = await call("/agent/signup", { method: "POST", headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ email, agent_name: agentName }) }, DEFAULT_TIMEOUT_MS, signal);
      const result = await json<SignupResult>(res, (v) => (isObject(v) && typeof v.api_key === "string" ? undefined : "no api_key"));
      return { created: res.status === 201, result };
    },

    async checkoutLink(plan, signal) {
      const res = await call("/agent/checkout-link", { method: "POST", headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ plan }) }, DEFAULT_TIMEOUT_MS, signal);
      return json<CheckoutLink>(res, (v) => (isObject(v) && typeof v.checkout_url === "string" ? undefined : "no checkout_url"));
    },

    async saveBrief(text, title, signal) {
      const res = await call("/v1/briefs", { method: "POST", headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(title === undefined ? { text } : { text, title }) }, DEFAULT_TIMEOUT_MS, signal);
      return withStringId(await json<SavedBrief>(res, (v) => (!isObject(v) ? "not an object" : !hasId(v) ? "no brief id" : checkReportShape(v.report))));
    },

    async listBriefs(signal) {
      const res = await call("/v1/briefs", { method: "GET", headers: headers() }, DEFAULT_TIMEOUT_MS, signal);
      const list = await json<BriefList>(res, (v) => {
        if (!isObject(v) || !Array.isArray(v.briefs)) return "no briefs list";
        return v.briefs.every((b) => isObject(b) && hasId(b)) ? undefined : "a brief without an id";
      });
      return { ...list, briefs: list.briefs.map(withStringId) };
    },

    async getBrief(id, signal) {
      const res = await call(briefPath(id), { method: "GET", headers: headers() }, DEFAULT_TIMEOUT_MS, signal);
      return withStringId(await json<Brief>(res, checkBriefShape));
    },

    async updateBrief(id, changes, signal) {
      const body: Record<string, string | boolean> = {};
      if (changes.text !== undefined) body.text = changes.text;
      if (changes.title !== undefined) body.title = changes.title;
      if (changes.recheck === true) body.recheck = true;
      const res = await call(briefPath(id), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) },
        DEFAULT_TIMEOUT_MS, signal);
      return withStringId(await json<UpdatedBrief>(res, (v) => {
        const problem = checkBriefShape(v);
        if (problem) return problem;
        const c = (v as Record<string, unknown>).changes;
        if (c === undefined || c === null) return undefined;
        return isObject(c) && Array.isArray(c.resolved) && Array.isArray(c.new) ? undefined : "changes without resolved and new lists";
      }));
    },

    async getBriefVersion(id, v, signal) {
      const res = await call(`${briefPath(id)}/versions/${encodeURIComponent(String(v))}`, { method: "GET", headers: headers() }, DEFAULT_TIMEOUT_MS, signal);
      return json<BriefVersion>(res, (x) => (isObject(x) && typeof x.text === "string" ? undefined : "no version text"));
    },

    async deleteBrief(id, signal) {
      const res = await call(briefPath(id), { method: "DELETE", headers: headers() }, DEFAULT_TIMEOUT_MS, signal);
      await res.body?.cancel().catch(() => {}); // 204 has no body; anything else is not needed
    },

    async suggest(query, options = {}, signal) {
      if (query.length > MAX_SUGGEST_QUERY_CHARS) {
        throw new ProofreadError(413, "too_large", `the query is ${query.length.toLocaleString("en-US")} characters long`);
      }
      const params: Record<string, string | number> = {};
      if (options.domain !== undefined) params.domain = options.domain;
      if (options.lang !== undefined) params.lang = options.lang;
      if (options.k !== undefined) params.k = options.k;
      const q = encodeURIComponent(query);
      const res = query.length <= SUGGEST_GET_MAX_CHARS && q.length <= SUGGEST_GET_MAX_ENCODED
        ? await call(`/v1/suggest?q=${q}${Object.entries(params).map(([name, value]) => `&${name}=${encodeURIComponent(String(value))}`).join("")}`,
          { method: "GET", headers: headers() }, DEFAULT_TIMEOUT_MS, signal)
        : await call("/v1/suggest", { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ q: query, ...params }) },
          DEFAULT_TIMEOUT_MS, signal);
      return json<SuggestAnswer>(res, checkSuggestShape);
    },

    siteOrigin() {
      try {
        return new URL(config.baseUrl).origin;
      } catch {
        return config.baseUrl;
      }
    },

    hasApiKey: () => Boolean(apiKey),
    setApiKey(key) {
      apiKey = key;
    },
  };
}

/** `?deep=1` streams SSE by default; `&stream=0` asks for one JSON after all checks. A default check has no query. */
export function verifyPath(deep: boolean, stream: boolean): string {
  if (!deep) return "/verify";
  return stream ? "/verify?deep=1" : "/verify?deep=1&stream=0";
}

/** Refuses an id that is not a plain token before it becomes part of a URL path. */
function briefPath(id: string): string {
  if (!BRIEF_ID_RE.test(id)) throw new ProofreadError(400, "bad_brief_id", "a brief id is 1 to 128 letters, digits, hyphens or underscores, as save_brief or list_briefs gives it");
  return `/v1/briefs/${encodeURIComponent(id)}`;
}

/** The API's ids are integers; everything past the client sees a string, the form the tools take and the URL needs. */
function withStringId<T extends { id: unknown }>(v: T): T & { id: string } {
  return { ...v, id: String(v.id) };
}

function hasId(v: Record<string, unknown>): boolean {
  return (typeof v.id === "string" && v.id.length > 0) || typeof v.id === "number";
}

/** A brief answer: an id, and a report that has the /verify shape when there is one. */
function checkBriefShape(v: unknown): string | undefined {
  if (!isObject(v)) return "not an object";
  if (!hasId(v)) return "no brief id";
  if (v.report !== undefined && v.report !== null) return checkReportShape(v.report);
  return undefined;
}

/** A suggestion answer: a status, and sections that each carry a list of results when there are any. */
function checkSuggestShape(v: unknown): string | undefined {
  if (!isObject(v) || typeof v.status !== "string") return "no status field";
  if (v.sections === undefined || v.sections === null) return undefined;
  if (!Array.isArray(v.sections)) return "sections is not a list";
  return v.sections.every((s) => isObject(s) && Array.isArray(s.results)) ? undefined : "a section without results";
}

function checkReportShape(v: unknown): string | undefined {
  if (!isObject(v)) return "not an object";
  if (!isObject(v.summary)) return "no summary";
  if (!Array.isArray(v.rows)) return "rows is not a list";
  if (typeof v.coverage !== "string") return "no coverage statement";
  return undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function bodyAsJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? anySignal([signal, timeout]) : timeout;
}

/** AbortSignal.any arrived in Node 20.3; older 20.x gets the same behaviour by hand. */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
