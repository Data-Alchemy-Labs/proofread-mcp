import { z } from "zod";
import { formatUpdatedBrief } from "../briefs_format.js";
import { BRIEF_ID_RE } from "../client.js";
import { rememberReport } from "../reports.js";
import { BRIEF_NEEDS_KEY, BRIEF_NOTE, LIMITS_NOTE, briefFail, defineTool, fail, ok, publicSummary } from "./tool.js";

export const updateBrief = defineTool({
  name: "update_brief",
  title: "Save an edited brief and re-check it",
  description:
    "Save an edited version of a brief saved in the user's proofread.law account and re-check it. " +
    "This is the loop for fixing flagged citations: edit the text (the citation, case name or quotation a row points at, or take the citation out), " +
    "call update_brief with the whole edited text, and read the changes: which flags were resolved (flagged before, not flagged now), " +
    "which flags are new, how many rows are unchanged, and then every row that still needs attention. " +
    "Repeat until every remaining row has been reviewed by the user. " +
    "Send the full text, not a diff or an excerpt: it becomes the latest version, and the previous version is kept (get_brief lists the versions). " +
    "recheck=true re-runs the check on the saved text without editing it, e.g. after the register was updated. " +
    "A changed text or a recheck counts as one check and keeps a new version; a title alone renames the brief without a check and is not counted. " + LIMITS_NOTE + " " + BRIEF_NOTE,
  inputSchema: {
    id: z.string().regex(BRIEF_ID_RE).describe("The brief id from save_brief or list_briefs."),
    text: z.string().min(1).max(2_000_000).optional().describe("The whole edited text of the brief. It replaces the latest version; the previous one is kept."),
    title: z.string().min(1).max(300).optional().describe("A new name for the brief."),
    recheck: z.boolean().optional().describe("Re-run the check on the saved text without editing it, e.g. after the register was updated."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run({ id, text, title, recheck }, { client }, extra) {
    if (text === undefined && title === undefined && recheck !== true) {
      return fail("give text (the whole edited brief), title (a new name), or recheck=true (check the saved text again).");
    }
    if (!client.hasApiKey()) return fail(BRIEF_NEEDS_KEY);
    try {
      const updated = await client.updateBrief(id, {
        ...(text !== undefined ? { text } : {}), ...(title !== undefined ? { title } : {}), ...(recheck === true ? { recheck: true } : {}),
      }, extra.signal);
      const reportId = updated.report && updated.changes ? rememberReport(updated.report) : undefined;
      const versions = updated.versions ?? [];
      const c = updated.changes;
      return ok(formatUpdatedBrief(updated, reportId, { text: text !== undefined, title: title !== undefined, recheck: recheck === true }), {
        id: updated.id,
        title: updated.title ?? null,
        updated_at: updated.updated_at ?? null,
        version: versions.length ? Math.max(...versions.map((x) => x.v)) : null,
        rechecked: Boolean(c),
        changes: c ? { resolved: c.resolved.length, new: c.new.length, unchanged: c.unchanged ?? 0 } : null,
        summary: updated.report ? publicSummary(updated.report.summary) : updated.summary ? publicSummary(updated.summary) : null,
        report_id: reportId ?? null,
      });
    } catch (err) {
      return briefFail(err, { id });
    }
  },
});
