#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startHttp } from "./http.js";
import { createServer, SERVER_VERSION } from "./server.js";

const HELP = `proofread-mcp ${SERVER_VERSION}: MCP server for proofread.law

Usage:
  proofread-mcp                 stdio transport (for Claude Desktop, Claude Code, Cursor)
  proofread-mcp --http          Streamable HTTP at http://127.0.0.1:3333/mcp
  proofread-mcp --http --port N --host H

Environment:
  PROOFREAD_API_KEY   API key (pl_...): from the sign_up tool or https://proofread.law/account. Any plan has keys;
                      a paid-plan key lifts the free-tier limits. Without a key the free tier applies per IP.
  PROOFREAD_API       Base URL (default https://proofread.law).
`;

interface Args {
  http: boolean;
  port: number;
  host: string;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { http: false, port: 3333, host: "127.0.0.1", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--http") args.http = true;
    else if (a === "--port") args.port = Number(argv[++i]);
    else if (a?.startsWith("--port=")) args.port = Number(a.slice(7));
    else if (a === "--host") args.host = String(argv[++i]);
    else if (a?.startsWith("--host=")) args.host = a.slice(7);
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) throw new Error("--port must be 0..65535");
  return args;
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    console.error(HELP);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.http) {
    const { url } = await startHttp({ port: args.port, host: args.host });
    console.error(`proofread-mcp listening on ${url}`); // stderr: stdout stays clean in both modes
    return;
  }
  // The client owns this process: when it goes away (stdin ends, or stdout breaks), stop, including any request still in flight.
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
  const server = createServer();
  server.server.onclose = () => process.exit(0);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("proofread-mcp:", err instanceof Error ? err.message : err);
  process.exit(1);
});
