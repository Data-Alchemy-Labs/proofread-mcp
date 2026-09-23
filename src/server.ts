import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient, type Client } from "./client.js";
import { configFromEnv, type Config } from "./config.js";
import { tools } from "./tools/index.js";

export const SERVER_NAME = "proofread-mcp";
export const SERVER_VERSION = "0.2.0";

export const INSTRUCTIONS =
  "proofread.law checks case citations against open registers: about 10 million US court opinions, and 1.1 million Swiss decisions (BGE/ATF/DTF, Federal Supreme Court dockets, the federal courts and all 26 cantons). "
  + "The jurisdiction is detected from the draft; a Swiss report comes back in the draft's language (German, French or Italian). " +
  "Tiers: red = check this (the register holds something concrete that disagrees), orange = cannot verify (nothing to check against; not evidence either way), " +
  "green = found, white = deep check (does the opinion support the sentence; a review queue, not a verdict). " +
  "Never call a red or orange row invented or untrue: say what was checked and what was found. " +
  "Every result carries a coverage statement; repeat it when reporting to the user. " +
  "Not covered: Westlaw/Lexis identifiers, statutes, regulations, secondary sources, whether a case is still good law. " +
  "Saved briefs are opt-in and stored encrypted in the user's account; nothing is saved unless save_brief or update_brief is called. " +
  "To fix flagged citations in a saved brief, edit the text, call update_brief with the brief id and the whole edited text, and read what changed (resolved flags, new flags) before the next edit. " +
  "Without an API key the free tier applies per IP; sign_up creates an account and key for the owner's inbox, billing_link gives the owner a checkout page when a quota is used up.";

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
