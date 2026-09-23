import { formatBriefList } from "../briefs_format.js";
import { BRIEF_NEEDS_KEY, BRIEF_NOTE, briefFail, defineTool, fail, ok } from "./tool.js";

export const listBriefs = defineTool({
  name: "list_briefs",
  title: "List the saved briefs",
  description:
    "List the briefs saved in the user's proofread.law account: id, title, when each was last saved and checked, the number of citations, " +
    "the counts per tier from its latest check, and the number of versions kept. " +
    "Use it to find a brief's id when the user refers to a draft by name, before get_brief, update_brief or delete_brief. " +
    "It only reads: this tool saves nothing and runs no check. " + BRIEF_NOTE,
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(_args, { client }, extra) {
    if (!client.hasApiKey()) return fail(BRIEF_NEEDS_KEY);
    try {
      const list = await client.listBriefs(extra.signal);
      return ok(formatBriefList(list), {
        briefs: list.briefs.map((b) => ({
          id: b.id,
          title: b.title ?? null,
          updated_at: b.updated_at ?? null,
          last_checked_at: b.last_checked_at ?? null,
          n_citations: b.n_citations ?? b.summary?.citations ?? null,
          versions: typeof b.versions === "number" ? b.versions : Array.isArray(b.versions) ? b.versions.length : null,
        })),
      });
    } catch (err) {
      return briefFail(err);
    }
  },
});
