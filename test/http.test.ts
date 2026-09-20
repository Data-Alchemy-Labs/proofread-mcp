import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClient } from "../src/client.js";
import { loopbackHosts, MAX_BODY_BYTES, startHttp } from "../src/http.js";
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

  it("answers 404 Session not found for an unknown session id on POST, GET and DELETE", async () => {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": "00000000-0000-0000-0000-000000000000" };
    for (const [method, body] of [["POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })], ["GET", undefined], ["DELETE", undefined]] as const) {
      const res = await fetch(server.url, { method, headers, ...(body ? { body } : {}) });
      expect(res.status, method).toBe(404);
      expect((await res.json()).error).toEqual({ code: -32001, message: "Session not found" });
    }
    expect((await (await fetch(server.url.replace(/\/mcp$/, "/health"))).json()).sessions).toBe(0); // nothing was created
  });

  it("refuses a body above the cap by Content-Length before reading it", async () => {
    const { port } = new URL(server.url);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/mcp", method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": MAX_BODY_BYTES + 1 } },
        (res) => { res.resume(); resolve(res.statusCode ?? 0); req.destroy(); });
      req.on("error", reject);
      req.write("{");
    });
    expect(status).toBe(413);
  });

  it("refuses a foreign Origin header", async () => {
    const res = await fetch(server.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "https://evil.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } }) });
    expect(res.status).toBe(403);
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
    expect(tools).toHaveLength(8);
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

describe("session limits", () => {
  it("reaps idle sessions and refuses new ones past the cap", async () => {
    const { fetch: apiFetch } = mockFetch({ body: { coverage: "C", storage: "S" } });
    const small = await startHttp({ port: 0, idleMs: 60, maxSessions: 1, client: createClient({ baseUrl: "https://api.test" }, apiFetch) });
    try {
      const health = async () => (await (await fetch(small.url.replace(/\/mcp$/, "/health"))).json()).sessions as number;
      const a = new Client({ name: "a", version: "0" });
      await a.connect(new StreamableHTTPClientTransport(new URL(small.url)));
      expect(await health()).toBe(1);
      const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "b", version: "0" } } });
      const second = await fetch(small.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: init });
      expect(second.status).toBe(503);
      await new Promise((r) => setTimeout(r, 200)); // idleMs 60, sweep every 60 ms
      expect(await health()).toBe(0);
      const third = await fetch(small.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: init });
      expect(third.status).toBe(200);
      await a.close().catch(() => {});
    } finally {
      await small.close();
    }
  });
});
