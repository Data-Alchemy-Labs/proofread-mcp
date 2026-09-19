import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient, type Client } from "./client.js";
import { configFromEnv, type Config } from "./config.js";
import { tools } from "./tools/index.js";

export const SERVER_NAME = "proofread-mcp";
export const SERVER_VERSION = "0.1.0";

export const INSTRUCTIONS =
  "proofread.law checks US case citations against an open register of about 10 million court opinions. " +
  "Tiers: red = check this (the register holds something concrete that disagrees), orange = cannot verify (nothing to check against; not evidence either way), " +
  "green = found, white = deep check (does the opinion support the sentence; a review queue, not a verdict). " +
  "Never describe a red or orange row as fabricated or fake: say what was checked and what was found. " +
  "Every result carries a coverage statement; repeat it when reporting to the user. " +
  "Not covered: Westlaw/Lexis identifiers, statutes, regulations, secondary sources, whether a case is still good law.";

export interface ServerOptions {
  config?: Config;
  client?: Client;
}

/** Builds an McpServer with every tool registered. The client can be injected for tests. */
export function createServer(options: ServerOptions = {}): McpServer {
  const config = options.config ?? configFromEnv();
  const client = options.client ?? createClient(config);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, ...(tool.annotations ? { annotations: tool.annotations } : {}) },
      (args, extra) => tool.run(args, { client }, extra),
    );
  }
  return server;
}
