import { z } from "zod";
import { BRIEF_ID_RE } from "../client.js";
import { BRIEF_NEEDS_KEY, BRIEF_NOTE, briefFail, defineTool, fail, ok } from "./tool.js";

export const deleteBrief = defineTool({
  name: "delete_brief",
  title: "Permanently delete a saved brief",
  description:
    "Permanently delete a brief and all its saved versions from the user's proofread.law account. " +
    "The deletion is permanent: it cannot be undone and the text cannot be recovered afterwards. " +
    "Only call it when the user asks to delete that brief; if the id is in any doubt, confirm it with list_briefs first. " +
    "Deleting runs no check. " + BRIEF_NOTE,
  inputSchema: {
    id: z.string().regex(BRIEF_ID_RE).describe("The id of the brief to delete, from save_brief or list_briefs."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async run({ id }, { client }, extra) {
    if (!client.hasApiKey()) return fail(BRIEF_NEEDS_KEY);
    try {
      await client.deleteBrief(id, extra.signal);
      return ok(`Deleted brief ${id} and its saved versions from your proofread.law account. This is permanent; they cannot be restored.`, { id, deleted: true });
    } catch (err) {
      return briefFail(err, { id });
    }
  },
});
