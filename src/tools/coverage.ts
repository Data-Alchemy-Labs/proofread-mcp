import { z } from "zod";
import type { CoverageCh } from "../types.js";
import { defineTool, fail, ok } from "./tool.js";

/** The Swiss answer as lines: the statement, then the courts held, largest first, with the share of the live index where it is measured. */
function swissLines(c: CoverageCh): string {
  const lines = [`Coverage: ${c.statement ?? "the Swiss register is not available on this instance"}`];
  const courts = (c.courts ?? []).slice(0, 8);
  if (courts.length) {
    lines.push("Courts held:");
    for (const court of courts) {
      const share = typeof court.live_index_share === "number" ? `, ${(court.live_index_share * 100).toFixed(2)}% of the live index` : "";
      const span = court.from ? `, from ${String(court.from).slice(0, 4)}` : "";
      lines.push(`  ${court.court}: ${court.decisions.toLocaleString("en-US")} decisions${span}${share}`);
    }
  }
  if (c.freshness?.dump) lines.push(`Source export ${c.freshness.dump}${c.freshness.live_index_checked ? `, live index checked ${c.freshness.live_index_checked}` : ""}`);
  lines.push(`Storage: ${c.storage}`);
  return lines.join("\n");
}

export const coverage = defineTool({
  name: "coverage",
  title: "What proofread.law checks against",
  description:
    "The coverage statement (which opinions the register holds, its date, its known gaps, what is not checked: Westlaw/Lexis identifiers, statutes, regulations, secondary sources) " +
    "and the storage notice (nothing submitted is stored). Pass jurisdiction 'ch' for the Swiss register instead (BGE/ATF/DTF, Federal Supreme Court dockets, the federal courts and the 26 cantons), " +
    "which also lists the courts held and the share of the live index each covers. Call it when a user asks what the check covers, how current it is, or what happens to their text. Free, not counted as a check.",
  inputSchema: { jurisdiction: z.enum(["us", "ch"]).optional().describe("Which register to describe. Default 'us'. 'ch' for Swiss case law.") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args, { client }, extra) {
    try {
      if (args.jurisdiction === "ch") {
        const c = await client.coverageCh(extra.signal);
        return ok(swissLines(c), { coverage: c.statement, storage: c.storage, jurisdiction: "ch", available: c.available, courts: c.courts ?? [], freshness: c.freshness ?? {} });
      }
      const c = await client.coverage(extra.signal);
      return ok(`Coverage: ${c.coverage}\nStorage: ${c.storage}`, { coverage: c.coverage, storage: c.storage, jurisdiction: "us" });
    } catch (err) {
      return fail(err);
    }
  },
});
