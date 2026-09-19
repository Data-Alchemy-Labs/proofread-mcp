import { defineTool, fail, ok } from "./tool.js";

export const coverage = defineTool({
  name: "coverage",
  title: "What proofread.law checks against",
  description:
    "The coverage statement (which opinions the register holds, its date, its known gaps, what is not checked: Westlaw/Lexis identifiers, statutes, regulations, secondary sources) " +
    "and the storage notice (nothing submitted is stored). Call it when a user asks what the check covers, how current it is, or what happens to their text. Free, not counted as a check.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(_args, { client }, extra) {
    try {
      const c = await client.coverage(extra.signal);
      return ok(`Coverage: ${c.coverage}\nStorage: ${c.storage}`, { coverage: c.coverage, storage: c.storage });
    } catch (err) {
      return fail(err);
    }
  },
});
