import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FetchLike } from "../src/client.js";
import { createClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import type { Report, ResolveBatch, ResolveResult, SuggestAnswer } from "../src/types.js";

const here = new URL(".", import.meta.url);

export function sampleReport(): Report {
  return JSON.parse(readFileSync(new URL("fixtures/report.json", here), "utf8")) as Report;
}

/** The real POST /v1/resolve answer for seven citations covering found, pincite, ambiguous, not_found, beyond_register, unresolvable, unparsed. */
export function resolveBatch(): ResolveBatch {
  return JSON.parse(readFileSync(new URL("fixtures/resolve-batch.json", here), "utf8")) as ResolveBatch;
}

export function resolveResult(status: ResolveResult["status"]): ResolveResult {
  const batch = resolveBatch();
  const r = batch.results.find((x) => x.status === status);
  if (!r) throw new Error(`no fixture result with status ${status}`);
  return { ...r, freshness: batch.freshness, coverage_statement: batch.coverage_statement };
}

/** Real GET /v1/suggest answers (dev branch, 2026-09-26): "Art. 41 OR, Art. 97 OR" k=3 (de), "art. 41 CO" k=3 (fr), "nothing here" (no_article). */
export function suggestFixture(name: "de" | "fr" | "noarticle"): SuggestAnswer {
  return JSON.parse(readFileSync(new URL(`fixtures/suggest-${name}.json`, here), "utf8")) as SuggestAnswer;
}

export const error429 = JSON.parse(readFileSync(new URL("fixtures/error-429.json", here), "utf8")) as unknown;

export const error402 = {
  error: { code: "plan_required", message: "deep check past the free allowance", plan: "solo", feature: "deep", upgrade: "https://proofread.law/pricing" },
};

export interface Call {
  url: string;
  init: RequestInit;
}

export interface Canned {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
  /** Throw instead of answering (network failure). */
  throws?: Error;
  /** A hand-built Response (for bodies that fail while being read). */
  response?: Response;
}

/** A fetch stub: answers each call from the queue in order (the last answer repeats) and records what was sent. */
export function mockFetch(...answers: Canned[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetch: FetchLike = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const a = answers[Math.min(i++, answers.length - 1)] ?? {};
    if (a.throws) throw a.throws;
    if (a.response) return a.response;
    const status = a.status ?? 200;
    const headers = new Headers(a.headers ?? {});
    if (a.text !== undefined) {
      if (!headers.has("content-type")) headers.set("content-type", "text/markdown");
      return new Response(a.text, { status, headers });
    }
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(a.body ?? {}), { status, headers });
  };
  return { fetch, calls };
}

/** An SSE body for `?deep=1`: the provisional report, one row event per row, then done. */
export function sseBody(report: Report, rows: Report["rows"], done: Record<string, unknown>): string {
  const parts = [`event: report\ndata: ${JSON.stringify(report)}\n\n`, ": keepalive\n\n"];
  for (const row of rows) parts.push(`event: row\ndata: ${JSON.stringify(row)}\n\n`);
  parts.push(`event: done\ndata: ${JSON.stringify(done)}\n\n`);
  return parts.join("");
}

/** A response whose body read fails (the headers arrived, the body did not). */
export function brokenBody(error: Error, contentType = "application/json"): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": contentType } });
}

/** A real MCP client wired to a real server over an in-memory transport, with fetch mocked. */
export async function connectedClient(...answers: Canned[]): Promise<{ mcp: Client; calls: Call[]; close(): Promise<void> }> {
  return connectedClientWith({ apiKey: "pl_test_key" }, ...answers);
}

export async function connectedClientWith(config: { apiKey?: string }, ...answers: Canned[]): Promise<{ mcp: Client; calls: Call[]; close(): Promise<void> }> {
  const { fetch, calls } = mockFetch(...answers);
  const api = createClient({ baseUrl: "https://api.test", ...config }, fetch);
  const server = createServer({ client: api });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(clientSide);
  return {
    mcp,
    calls,
    close: async () => {
      await mcp.close();
      await server.close();
    },
  };
}

export function textOf(result: unknown): string {
  const r = result as { content: Array<{ type: string; text?: string }> };
  return r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}
