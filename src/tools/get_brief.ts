import { z } from "zod";
import { formatBrief, formatBriefVersion } from "../briefs_format.js";
import { BRIEF_ID_RE } from "../client.js";
import { rememberReport } from "../reports.js";
import { BRIEF_NEEDS_KEY, BRIEF_NOTE, briefFail, defineTool, fail, ok, publicSummary } from "./tool.js";

export const getBrief = defineTool({
  name: "get_brief",
  title: "Get a saved brief and its latest report",
  description:
    "Get one brief saved in the user's proofread.law account: its saved text, the latest report (coverage statement, counts per tier, " +
    "the rows that need attention, a report id for render_report) and the versions kept. " +
    "Use it to pick up where the user left off, or to get the exact saved text before editing it for update_brief. " +
    "include_text=false returns the report without the text (a long brief is long). " +
    "Pass version to read an earlier version's text and counts instead of the latest. " +
    "It only reads: this tool saves nothing and runs no check. " + BRIEF_NOTE,
  inputSchema: {
    id: z.string().regex(BRIEF_ID_RE).describe("The brief id from save_brief or list_briefs."),
    include_text: z.boolean().default(true).describe("Return the saved text (default true). false returns only the report."),
    version: z.number().int().min(1).optional().describe("An earlier version number from the versions list; omit for the latest."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ id, include_text, version }, { client }, extra) {
    if (!client.hasApiKey()) return fail(BRIEF_NEEDS_KEY);
    try {
      if (version !== undefined) {
        const v = await client.getBriefVersion(id, version, extra.signal);
        return ok(formatBriefVersion(id, v), { id, version: v.v, created_at: v.created_at ?? null, summary: v.summary ? publicSummary(v.summary) : null });
      }
      const brief = await client.getBrief(id, extra.signal);
      const reportId = brief.report ? rememberReport(brief.report) : undefined;
      return ok(formatBrief(brief, reportId, include_text), {
        id: brief.id,
        title: brief.title ?? null,
        updated_at: brief.updated_at ?? null,
        summary: brief.report ? publicSummary(brief.report.summary) : brief.summary ? publicSummary(brief.summary) : null,
        coverage: brief.report?.coverage ?? null,
        versions: (brief.versions ?? []).map((x) => ({ v: x.v, created_at: x.created_at ?? null })),
        report_id: reportId ?? null,
        text_included: include_text && typeof brief.text === "string",
      });
    } catch (err) {
      return briefFail(err, { id, version });
    }
  },
});
