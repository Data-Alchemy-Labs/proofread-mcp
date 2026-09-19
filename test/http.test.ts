import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClient } from "../src/client.js";
import { startHttp } from "../src/http.js";
import { mockFetch, sampleReport, textOf } from "./helpers.js";

describe("Streamable HTTP transport", () => {
  let server: Awaited<ReturnType<typeof startHttp>>;
  const { fetch: apiFetch, calls } = mockFetch({ body: { coverage: "C", storage: "S" } }, { body: sampleReport() });

  beforeAll(async () => {
    server = await startHttp({ port: 0, client: createClient({ baseUrl: "https://api.test" }, apiFetch) });
  });
  afterAll(async () => {
    await server.close();
  });

  it("answers /health", async () => {
    const res = await fetch(server.url.replace(/\/mcp$/, "/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sessions: 0 });
  });

  it("refuses a non-initialize request without a session", async () => {
    const res = await fetch(server.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(res.status).toBe(400);
  });

  it("serves a full session: initialize, tools/list, tools/call", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    const mcp = new Client({ name: "http-test", version: "0" });
    await mcp.connect(transport);
    expect(transport.sessionId).toMatch(/[0-9a-f-]{36}/);
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(5);
    expect(textOf(await mcp.callTool({ name: "coverage", arguments: {} }))).toBe("Coverage: C\nStorage: S");
    expect(textOf(await mcp.callTool({ name: "check_citations", arguments: { text: "x" } }))).toContain("- CHECK THIS: 509 U.S. 644");
    expect(calls).toHaveLength(2);
    const health = await (await fetch(server.url.replace(/\/mcp$/, "/health"))).json();
    expect(health.sessions).toBe(1);
    await transport.terminateSession();
    await mcp.close();
  });

  it("404 elsewhere", async () => {
    expect((await fetch(server.url.replace(/\/mcp$/, "/other"))).status).toBe(404);
  });
});
