import type { ApiErrorBody } from "./types.js";

/** An error answered by proofread.law, or a failure to reach it. `status` is 0 when no HTTP answer arrived. */
export class ProofreadError extends Error {
  readonly status: number;
  readonly code: string;
  readonly info: Record<string, unknown>;

  constructor(status: number, code: string, message: string, info: Record<string, unknown> = {}) {
    super(message);
    this.name = "ProofreadError";
    this.status = status;
    this.code = code;
    this.info = info;
  }

  static fromBody(status: number, body: unknown): ProofreadError {
    const err = (body as Partial<ApiErrorBody>)?.error;
    if (err && typeof err.code === "string") {
      const { code, message, ...info } = err;
      return new ProofreadError(status, code, message ?? code, info);
    }
    return new ProofreadError(status, `http_${status}`, `proofread.law answered HTTP ${status}`);
  }

  static network(baseUrl: string, cause: unknown): ProofreadError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new ProofreadError(0, "network", `Could not reach ${baseUrl}: ${detail}`);
  }

  /** fetch rejected: our timeout fired, the MCP client cancelled, or the host was not reachable. */
  static fromFetchFailure(baseUrl: string, cause: unknown): ProofreadError {
    const name = cause instanceof Error ? cause.name : "";
    if (name === "TimeoutError") return new ProofreadError(0, "timeout", `no answer from ${baseUrl} in time`);
    if (name === "AbortError") return new ProofreadError(0, "cancelled", "the request was cancelled by the client");
    return ProofreadError.network(baseUrl, cause);
  }
}

/** One plain sentence a model can act on. Wording follows PRODUCT.md: what was checked, what was found, what to do next. */
export function explain(err: unknown): string {
  if (!(err instanceof ProofreadError)) {
    return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  }
  const i = err.info;
  switch (err.code) {
    case "network":
    case "cancelled":
      return err.message;
    case "plan_required":
      return `proofread.law: this needs the ${String(i.plan ?? "paid")} plan` +
        (i.feature ? ` (${String(i.feature)})` : "") + ". " +
        (i.upgrade ? `Upgrade at ${String(i.upgrade)}. ` : "") +
        "A Firm API key goes in PROOFREAD_API_KEY.";
    case "rate_limited":
      return `proofread.law rate limit: ${err.message}.` +
        (i.retry_after ? ` Retry after ${String(i.retry_after)} s.` : "");
    case "quota_exceeded":
      return `proofread.law monthly allowance used` +
        (i.used !== undefined && i.limit !== undefined ? ` (${String(i.used)} of ${String(i.limit)})` : "") +
        "." + (i.upgrade ? ` Upgrade at ${String(i.upgrade)}.` : "") +
        " A Firm API key in PROOFREAD_API_KEY lifts the free-tier limits.";
    case "bad_key":
      return "proofread.law rejected the API key in PROOFREAD_API_KEY (unknown or revoked).";
    case "too_large":
      return `proofread.law: the input is too large (${err.message}); the cap is 10 MB.`;
    case "unreadable":
    case "unparseable":
      return `proofread.law could not read the file: ${err.message}. Scanned PDFs without a text layer, encrypted PDFs and legacy .doc are not supported.`;
    case "deep_budget_exhausted":
      return "proofread.law: the deep-check budget for today is spent. Run the check without deep=true; the default check still works.";
    case "timeout":
      return `proofread.law timed out: ${err.message}. Try a shorter text or split the document.`;
    default:
      return `proofread.law error ${err.code} (HTTP ${err.status}): ${err.message}`;
  }
}
