import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type ServerOptions } from "./server.js";

export interface HttpOptions extends ServerOptions {
  port: number;
  host?: string;
  /** Hosts allowed in the Host header (DNS-rebinding protection). Defaults to localhost forms when binding to loopback. */
  allowedHosts?: string[];
}

/**
 * Serves MCP over Streamable HTTP at /mcp: one McpServer and transport per session (initialize starts one,
 * the Mcp-Session-Id header names it, DELETE ends it). GET /health answers 200 for load balancers.
 */
export function startHttp(options: HttpOptions): Promise<{ close(): Promise<void>; url: string }> {
  const host = options.host ?? "127.0.0.1";
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  // With port 0 the OS picks the port; DNS-rebinding protection then needs the hosts passed in explicitly.
  const allowedHosts = options.allowedHosts ?? (loopback && options.port > 0 ? [`127.0.0.1:${options.port}`, `localhost:${options.port}`, "127.0.0.1", "localhost"] : undefined);
  const sessions = new Map<string, StreamableHTTPServerTransport>();

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
    const sessionId = req.headers["mcp-session-id"];
    const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "no session; POST initialize first" }, id: null }));
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
      ...(allowedHosts ? { allowedHosts, enableDnsRebindingProtection: true } : {}),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    const server = createServer(options);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

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
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        url: `http://${host}:${port}/mcp`,
        close: async () => {
          await Promise.all([...sessions.values()].map((t) => t.close()));
          await new Promise<void>((done) => httpServer.close(() => done()));
        },
      });
    });
  });
}
