import type { Config } from "./config.js";
import { ProofreadError } from "./errors.js";
import { readSseReport } from "./sse.js";
import type { CheckoutLink, Coverage, Report, ResolveBatch, ResolveResult, Row, SignupResult } from "./types.js";

export const USER_AGENT = "proofread-mcp/0.1.1 (+https://github.com/Data-Alchemy-Labs/proofread-mcp)";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_BATCH_CITES = 500;

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

export interface Client {
  verifyText(text: string, options?: VerifyOptions): Promise<Report>;
  verifyFile(bytes: Uint8Array, filename: string, options?: VerifyOptions): Promise<Report>;
  /** One citation string against the register (GET /v1/resolve). Counts against the resolve quota, not the check quota. */
  resolveV1(cite: string, signal?: AbortSignal): Promise<ResolveResult>;
  /** Up to 500 citation strings in one call (POST /v1/resolve); results come back in input order. */
  resolveBatch(cites: string[], signal?: AbortSignal): Promise<ResolveBatch>;
  renderMarkdown(report: Report, signal?: AbortSignal): Promise<string>;
  coverage(signal?: AbortSignal): Promise<Coverage>;
  /** POST /agent/signup: an account and a key for the owner's inbox. `created` is false when an existing unconfirmed account's key was rotated. */
  signUp(email: string, agentName: string, signal?: AbortSignal): Promise<{ created: boolean; result: SignupResult }>;
  /** POST /agent/checkout-link with the key: a Stripe Checkout page for the owner. */
  checkoutLink(plan: Plan, signal?: AbortSignal): Promise<CheckoutLink>;
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
