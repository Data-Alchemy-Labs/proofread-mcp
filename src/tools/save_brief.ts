import { z } from "zod";
import { formatSavedBrief } from "../briefs_format.js";
import { rememberReport } from "../reports.js";
import { BRIEF_NEEDS_KEY, BRIEF_NOTE, LIMITS_NOTE, briefFail, defineTool, fail, ok, publicSummary } from "./tool.js";

export const saveBrief = defineTool({
  name: "save_brief",
  title: "Save a brief to the account and check it",
  description:
    "Save a brief (or any draft that cites cases) to the user's proofread.law account and check its citations in the same call. " +
    "Use it when the user asks to keep a draft and come back to it, or to start the edit-and-recheck loop: save once, then after each round of edits call update_brief with the id. " +
    "Returns the brief id, the coverage statement, counts per tier, one line per row that needs attention " +
    "(red = check this: the register holds something concrete that disagrees; orange = cannot verify: nothing to check against, not evidence either way), " +
    "and a report id for render_report. Only call it when the user wants the draft saved; to check without saving, use check_citations. " +
    "Each call saves a new brief and counts as one check. " + LIMITS_NOTE + " " + BRIEF_NOTE,
  inputSchema: {
    text: z.string().min(1).max(2_000_000).describe("The full text of the brief, as written (paragraphs, footnotes, the whole draft)."),
    title: z.string().min(1).max(300).optional().describe("A name the user will recognise in list_briefs, e.g. 'Motion to dismiss, Smith v. Jones'."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run({ text, title }, { client }, extra) {
    if (!client.hasApiKey()) return fail(BRIEF_NEEDS_KEY);
    try {
      const saved = await client.saveBrief(text, title, extra.signal);
      const reportId = rememberReport(saved.report);
      return ok(formatSavedBrief(saved, reportId), {
        id: saved.id,
        title: saved.title ?? null,
        created_at: saved.created_at ?? null,
        updated_at: saved.updated_at ?? null,
        summary: publicSummary(saved.report.summary),
        coverage: saved.report.coverage,
        report_id: reportId,
      });
    } catch (err) {
      return briefFail(err);
    }
  },
});
