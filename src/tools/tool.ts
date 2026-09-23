import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { Client } from "../client.js";
import { explain, ProofreadError } from "../errors.js";
import type { Summary } from "../types.js";

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export interface ToolContext {
  client: Client;
}

/** One tool = one file. `run` gets parsed arguments, the shared client, and the request extras (signal, progress token). */
export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  annotations?: ToolAnnotations;
  run(args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext, extra: ToolExtra): Promise<CallToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}

export function ok(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return structuredContent ? { content: [{ type: "text", text }], structuredContent } : { content: [{ type: "text", text }] };
}

/** Errors go back as a tool result the model can read and act on, not as a protocol error. A string is the sentence itself. */
export function fail(err: unknown): CallToolResult {
  return { content: [{ type: "text", text: explain(err) }], isError: true };
}

export interface Progress {
  report(done: number, total: number | undefined, message: string): void;
  /** Wait for the notifications to be written before the result goes out, so none arrives after it. */
  flush(): Promise<void>;
}

/** Sends MCP progress notifications when the client asked for them (deep checks take a while). */
export function progressReporter(extra: ToolExtra): Progress {
  const token = extra._meta?.progressToken;
  const pending: Promise<void>[] = [];
  return {
    report(done, total, message) {
      if (token === undefined) return;
      const capped = total !== undefined ? Math.max(total, done) : undefined;
      pending.push(extra
        .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: done, ...(capped !== undefined ? { total: capped } : {}), message } })
        .catch(() => {}));
    },
    async flush() {
      await Promise.allSettled(pending);
    },
  };
}

/** The summary as structured content: the API's counts without its internal cost counter. */
export function publicSummary(summary: Partial<Summary>): Record<string, unknown> {
  const { jev_spent_today_usd: _cost, ...rest } = summary;
  return rest;
}

export const LIMITS_NOTE =
  "Cannot: resolve Westlaw (WL) or Lexis identifiers, check statutes, regulations or secondary sources, or say whether a case is still good law. " +
  "A red row means 'check this', never 'this case does not exist'; an orange row means the register has nothing to check against, which is not evidence either way.";

export const DEEP_NOTE =
  "deep=true also asks, for each found citation, whether the opinion supports the sentence it is cited for (white rows). " +
  "It is slower (1 to 2 s per citation), opt-in because the clause before each citation is sent to a model judge, limited to 3 per month on the free tier, " +
  "and its answers are a review queue, not a verdict.";

export const KEY_NOTE =
  "Without an API key the free tier applies per IP address; a key from sign_up (free tier) identifies the account, and a paid-plan key lifts the limits.";

export const BRIEF_NOTE =
  "Saving is opt-in: nothing is saved unless save_brief or update_brief is called (check_citations and check_document never save anything). " +
  "A saved brief is stored encrypted in the user's proofread.law account until delete_brief removes it, and needs an API key (PROOFREAD_API_KEY, or one from sign_up).";

/** Checked before any call: a saved brief belongs to an account, so without a key nothing is sent. */
export const BRIEF_NEEDS_KEY =
  "Saved briefs live in a proofread.law account, so they need an API key: set PROOFREAD_API_KEY, or call sign_up first to create an account and key. Nothing was sent or saved.";

/** A 404 on a brief route names the id (the API answers 404 for a missing id and for another account's id alike); the rest goes through explain. */
export function briefFail(err: unknown, where: { id?: string; version?: number } = {}): CallToolResult {
  if (err instanceof ProofreadError && err.status === 404) {
    if (where.id && where.version !== undefined) {
      return fail(`No version ${where.version} of saved brief ${where.id} in this account. get_brief without a version lists the versions kept.`);
    }
    if (where.id) return fail(`No saved brief ${where.id} in this account. list_briefs shows the ids of the saved briefs.`);
    return fail("This proofread.law server does not offer saved briefs (HTTP 404), so nothing was saved. check_citations still checks a text without saving it.");
  }
  return fail(err);
}
