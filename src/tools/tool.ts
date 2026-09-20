import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { Client } from "../client.js";
import { explain } from "../errors.js";
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
export function publicSummary(summary: Summary): Record<string, unknown> {
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
