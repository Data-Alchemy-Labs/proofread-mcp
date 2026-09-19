import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClient } from "../src/client.js";
import { loopbackHosts, startHttp } from "../src/http.js";
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

  it("rejects a foreign Host header (DNS rebinding) even on an OS-picked port", async () => {
    // fetch drops a custom Host header, so this goes through node:http.
    const { port } = new URL(server.url);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } });
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/mcp", method: "POST",
        headers: { host: "evil.example:80", "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": Buffer.byteLength(body) } },
        (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", reject);
      req.end(body);
    });
    expect(status).toBe(403);
  });

  it("loopbackHosts covers IPv4, IPv6 and names; nothing for a real interface", () => {
    expect(loopbackHosts("127.0.0.1", 3333)).toEqual(["127.0.0.1:3333", "localhost:3333", "127.0.0.1", "localhost"]);
    expect(loopbackHosts("::1", 3333)).toEqual(["[::1]:3333", "localhost:3333", "[::1]", "localhost"]);
    expect(loopbackHosts("0.0.0.0", 3333)).toBeUndefined();
  });

  it("404 elsewhere", async () => {
    expect((await fetch(server.url.replace(/\/mcp$/, "/other"))).status).toBe(404);
  });
});
