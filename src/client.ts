import type { Config } from "./config.js";
import { ProofreadError } from "./errors.js";
import { readSseReport } from "./sse.js";
import type { Coverage, Report, Row } from "./types.js";

export const USER_AGENT = "proofread-mcp/0.1.0 (+https://github.com/Data-Alchemy-Labs/proofread-mcp)";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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

export interface Client {
  verifyText(text: string, options?: VerifyOptions): Promise<Report>;
  verifyFile(bytes: Uint8Array, filename: string, options?: VerifyOptions): Promise<Report>;
  /** One citation string to one row. Today it goes through /verify; it will move to /v1/resolve when that route exists. */
  resolveCitation(cite: string, signal?: AbortSignal): Promise<{ row: Row | undefined; report: Report }>;
  renderMarkdown(report: Report, signal?: AbortSignal): Promise<string>;
  coverage(signal?: AbortSignal): Promise<Coverage>;
}

export function createClient(config: Config, fetchImpl: FetchLike = globalThis.fetch): Client {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/event-stream",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
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

  async function verify(body: string | FormData, contentType: string | undefined, options: VerifyOptions): Promise<Report> {
    const deep = options.deep === true;
    const path = verifyPath(deep, deep && options.onRow !== undefined);
    const res = await call(path, { method: "POST", headers: headers(contentType ? { "Content-Type": contentType } : {}), body },
      deep ? DEEP_TIMEOUT_MS : DEFAULT_TIMEOUT_MS, options.signal);
    return readReport(res, options.onRow);
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

    async resolveCitation(cite, signal) {
      const report = await verify(JSON.stringify({ text: cite }), "application/json", signal ? { signal } : {});
      return { row: report.rows[0], report };
    },

    async renderMarkdown(report, signal) {
      const res = await call("/render?format=md", { method: "POST", headers: headers({ "Content-Type": "application/json", Accept: "text/markdown" }),
        body: JSON.stringify(report) }, DEFAULT_TIMEOUT_MS, signal);
      return res.text();
    },

    async coverage(signal) {
      const res = await call("/api/coverage", { method: "GET", headers: headers() }, DEFAULT_TIMEOUT_MS, signal);
      return (await res.json()) as Coverage;
    },
  };
}

/** `?deep=1` streams SSE by default; `&stream=0` asks for one JSON after all checks. A default check has no query. */
export function verifyPath(deep: boolean, stream: boolean): string {
  if (!deep) return "/verify";
  return stream ? "/verify?deep=1" : "/verify?deep=1&stream=0";
}

async function readReport(res: Response, onRow?: VerifyOptions["onRow"]): Promise<Report> {
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("text/event-stream")) {
    if (!res.body) throw new ProofreadError(0, "empty_stream", "the event stream had no body");
    return readSseReport(res.body, onRow);
  }
  return (await res.json()) as Report;
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
