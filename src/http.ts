import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type ServerOptions } from "./server.js";

export interface HttpOptions extends ServerOptions {
  port: number;
  host?: string;
  /** Hosts allowed in the Host header (DNS-rebinding protection). Defaults to localhost forms when binding to loopback. */
  allowedHosts?: string[];
  /** Close a session after this long without a request. Default 30 minutes. */
  idleMs?: number;
  /** Refuse new sessions past this many open ones. Default 200. */
  maxSessions?: number;
}

/** A request body larger than this is refused before the transport reads it (the API caps input at 10 MB). */
export const MAX_BODY_BYTES = 12 * 1024 * 1024;
const SWEEP_MS = 60_000;

interface Session {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

/**
 * Serves MCP over Streamable HTTP at /mcp: one McpServer and transport per session (initialize starts one,
 * the Mcp-Session-Id header names it, DELETE ends it, idle sessions are reaped). GET /health answers 200 for load balancers.
 * Single-tenant by design: no authentication of its own, and report ids are shared across sessions.
 */
export function startHttp(options: HttpOptions): Promise<{ close(): Promise<void>; url: string }> {
  const host = options.host ?? "127.0.0.1";
  const idleMs = options.idleMs ?? 30 * 60_000;
  const maxSessions = options.maxSessions ?? 200;
  let port = options.port; // replaced by the bound port once listening (port 0 lets the OS pick)
  const sessions = new Map<string, Session>();

  function jsonError(res: ServerResponse, status: number, code: number, message: string): void {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, sessions: sessions.size }));
      return;
    }
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found; MCP is served at /mcp");
      return;
    }
    const length = Number(req.headers["content-length"] ?? 0);
    if (length > MAX_BODY_BYTES) {
      jsonError(res, 413, -32000, `request body too large (${length} bytes; the cap is ${MAX_BODY_BYTES})`);
      return;
    }
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId === "string") {
      const session = sessions.get(sessionId);
      if (!session) {
        jsonError(res, 404, -32001, "Session not found"); // the signal SDK clients use to re-initialize
        return;
      }
      session.lastSeen = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }
    if (req.method !== "POST") {
      jsonError(res, 400, -32000, "no session; POST initialize first");
      return;
    }
    if (sessions.size >= maxSessions) {
      jsonError(res, 503, -32000, `too many open sessions (${sessions.size}); try again later`);
      return;
    }
    const hosts = options.allowedHosts ?? loopbackHosts(host, port);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, lastSeen: Date.now() });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
      ...(hosts ? { allowedHosts: hosts, allowedOrigins: hosts.map((h) => `http://${h}`), enableDnsRebindingProtection: true } : {}),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    const server = createServer(options);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  const sweeper = setInterval(() => {
    const cutoff = Date.now() - idleMs;
    for (const [id, s] of sessions) {
      if (s.lastSeen < cutoff) {
        sessions.delete(id);
        void s.transport.close().catch(() => {});
      }
    }
  }, Math.min(SWEEP_MS, idleMs));
  sweeper.unref();

  const httpServer = createHttpServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("proofread-mcp http:", err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" }).end("internal error");
      else res.end();
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, host, () => {
      const address = httpServer.address();
      if (typeof address === "object" && address) port = address.port;
      resolve({
        url: `http://${host}:${port}/mcp`,
        close: async () => {
          clearInterval(sweeper);
          await Promise.all([...sessions.values()].map((s) => s.transport.close()));
          await new Promise<void>((done) => httpServer.close(() => done()));
        },
      });
    });
  });
}

/** The Host header values a loopback bind should accept; undefined (no protection) when bound to a real interface. */
export function loopbackHosts(host: string, port: number): string[] | undefined {
  if (host === "127.0.0.1" || host === "localhost") return [`127.0.0.1:${port}`, `localhost:${port}`, "127.0.0.1", "localhost"];
  if (host === "::1") return [`[::1]:${port}`, `localhost:${port}`, "[::1]", "localhost"];
  return undefined;
}
