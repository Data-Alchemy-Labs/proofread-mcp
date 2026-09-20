import { z } from "zod";
import { formatReport } from "../format.js";
import { rememberReport } from "../reports.js";
import type { Report, Row } from "../types.js";
import { DEEP_NOTE, KEY_NOTE, LIMITS_NOTE, defineTool, fail, ok, progressReporter, publicSummary, type Progress, type ToolExtra } from "./tool.js";

export const checkCitations = defineTool({
  name: "check_citations",
  title: "Check legal citations in text",
  description:
    "Check every case citation in a text against proofread.law's register of about 10 million US court opinions (CourtListener bulk data). " +
    "Use it on a draft brief, memo, letter or any prose that cites cases, before the citations are relied on. " +
    "Returns the coverage statement, counts per tier, one line per row that needs a human " +
    "(red = check this: the register holds something concrete that disagrees, such as a different case at that citation or quoted words not in the opinion; " +
    "orange = cannot verify: nothing to check against, such as a Westlaw/Lexis identifier or a volume newer than the register), " +
    "the number of citations found, and a report id for render_report. " +
    LIMITS_NOTE + " " + DEEP_NOTE + " Free tier: 20 checks a month. " + KEY_NOTE,
  inputSchema: {
    text: z.string().min(1).max(2_000_000).describe("The text to check, as written (paragraphs, footnotes, a whole brief). Pasted text is fine."),
    deep: z.boolean().optional().describe("Also check whether each cited opinion supports the sentence it is cited for. Slower, opt-in, 3 per month on the free tier."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ text, deep }, { client }, extra) {
    const { options, progress } = verifyOptions(deep, extra);
    try {
      const report = await client.verifyText(text, options);
      await progress.flush();
      return ok(formatReport(report, rememberReport(report)), { summary: publicSummary(report.summary), coverage: report.coverage });
    } catch (err) {
      await progress.flush();
      return fail(err);
    }
  },
});

/** Deep checks stream rows; each finished row becomes a progress notification when the client asked for progress. */
export function verifyOptions(deep: boolean | undefined, extra: ToolExtra): { options: { deep?: boolean; onRow?: (row: Row, report: Report) => void; signal: AbortSignal }; progress: Progress } {
  const progress = progressReporter(extra);
  if (!deep) return { options: { signal: extra.signal }, progress };
  if (extra._meta?.progressToken === undefined) return { options: { deep: true, signal: extra.signal }, progress };
  let done = 0;
  return {
    progress,
    options: {
      deep: true,
      signal: extra.signal,
      onRow: (row, report) => {
        done += 1;
        progress.report(done, report.summary.deep_pending, `${row.citation}: ${row.support?.headline ?? row.headline}`);
      },
    },
  };
}
