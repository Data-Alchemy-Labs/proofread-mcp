import type { ApiErrorBody } from "./types.js";

/** An error answered by proofread.law, or a failure to reach or read it. `status` is 0 when no HTTP answer arrived. */
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
    return new ProofreadError(0, "network", `Could not reach ${baseUrl}: ${describeCause(cause)}`);
  }

  /** fetch or a body read rejected: our timeout fired, the MCP client cancelled, the connection dropped, or the host was not reachable. */
  static fromFetchFailure(baseUrl: string, cause: unknown, reading = false): ProofreadError {
    const name = cause instanceof Error ? cause.name : "";
    if (name === "TimeoutError") return new ProofreadError(0, "timeout", `no ${reading ? "complete answer" : "answer"} from ${baseUrl} in time`);
    if (name === "AbortError") return new ProofreadError(0, "cancelled", "the request was cancelled by the client");
    if (reading) return new ProofreadError(0, "connection_dropped", `the connection to ${baseUrl} dropped while the answer was being read: ${describeCause(cause)}`);
    return ProofreadError.network(baseUrl, cause);
  }
}

/** undici puts the real reason (ECONNREFUSED, ENOTFOUND, ...) one level down in `cause`. */
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const inner = (cause as { cause?: { code?: string; message?: string } }).cause;
  const detail = inner?.code ?? inner?.message;
  return detail && detail !== cause.message ? `${cause.message} (${detail})` : cause.message;
}

/**
 * One plain sentence a model can act on. A string is already that sentence (a deliberate local result);
 * a ProofreadError is translated by code; anything else is a genuine surprise and says so.
 * Wording follows PRODUCT.md: what was checked, what was found, what to do next.
 */
export function explain(err: unknown): string {
  if (typeof err === "string") return err;
  if (!(err instanceof ProofreadError)) {
    return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  }
  const i = err.info;
  switch (err.code) {
    case "network":
    case "cancelled":
    case "connection_dropped":
    case "stream_incomplete":
    case "bad_content_type":
    case "bad_shape":
      return err.message;
    case "plan_required":
      return `proofread.law: this needs the ${String(i.plan ?? "paid")} plan` +
        (i.feature ? ` (${String(i.feature)})` : "") + ". " +
        (i.upgrade ? `Upgrade at ${String(i.upgrade)}. ` : "") +
        "The billing_link tool gives the account owner a checkout link; a paid-plan API key goes in PROOFREAD_API_KEY.";
    case "rate_limited":
      return `proofread.law rate limit: ${err.message}.` +
        (i.retry_after ? ` Retry after ${String(i.retry_after)} s.` : "");
    case "quota_exceeded":
      return `proofread.law monthly allowance used` +
        (i.used !== undefined && i.limit !== undefined ? ` (${String(i.used)} of ${String(i.limit)})` : "") +
        "." + (i.upgrade ? ` Upgrade at ${String(i.upgrade)}.` : "") +
        " The billing_link tool gives the account owner a checkout link; a paid-plan API key lifts the free-tier limits.";
    case "bad_key":
      return "proofread.law rejected the API key in PROOFREAD_API_KEY (unknown or revoked).";
    case "signed_out":
      return "proofread.law needs an API key for this: set PROOFREAD_API_KEY, or call sign_up to create an account and key.";
    case "missing_cite":
    case "too_many":
    case "bad_email":
    case "bad_agent_name":
    case "bad_plan":
      return `proofread.law: ${err.message}.`;
    case "exists":
      return `proofread.law: ${err.message}.`;
    case "key_limit":
      return `proofread.law: ${err.message}.`;
    case "already_subscribed":
      return `proofread.law: ${err.message}.`;
    case "billing_off":
    case "billing_failed":
      return `proofread.law: ${err.message}. Try again later, or the owner can subscribe at https://proofread.law/pricing.`;
    case "storage_off":
      return "proofread.law: saved briefs are switched off on this server, so nothing was saved or read. check_citations still checks a text without saving it.";
    case "bad_brief_id":
      return `proofread.law: ${err.message}. list_briefs shows the ids of the saved briefs.`;
    case "too_large":
      return `proofread.law: the input is too large (${err.message}); the cap is 10 MB.`;
    case "empty":
    case "unreadable":
    case "unparseable":
      return `proofread.law could not read the input: ${err.message}. Scanned PDFs without a text layer, encrypted PDFs and legacy .doc are not supported.`;
    case "deep_budget_exhausted":
      return "proofread.law: the deep-check budget for today is spent. Run the check without deep=true; the default check still works.";
    case "timeout":
      return `proofread.law timed out: ${err.message}. Try a shorter text or split the document.`;
    default:
      return `proofread.law error ${err.code} (HTTP ${err.status}): ${err.message}`;
  }
}
