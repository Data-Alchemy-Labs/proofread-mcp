import { z } from "zod";
import { formatRowDetail } from "../format.js";
import { LIMITS_NOTE, defineTool, fail, ok } from "./tool.js";

export const resolveCitation = defineTool({
  name: "resolve_citation",
  title: "Look up one citation",
  description:
    "Look up a single case citation (for example '590 U.S. 644', or 'Bostock v. Clayton County, 590 U.S. 644 (2020)') in proofread.law's register and answer: " +
    "is there a case at this citation, which one (name, court, date, parallel citations, link), and how complete the register is for it. " +
    "Use it when one citation is in doubt; use check_citations for whole passages. " +
    "A citation that is not found is a register fact with a coverage caveat, not proof that the case does not exist. " +
    LIMITS_NOTE + " Each call counts as one check on the free tier.",
  inputSchema: {
    citation: z.string().min(3).max(500).describe("One citation, with the case name if known. Quoted language after the citation is checked too."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ citation }, { client }, extra) {
    try {
      const { row, report } = await client.resolveCitation(citation, extra.signal);
      if (!row) {
        return ok(`No case citation was recognised in: ${JSON.stringify(citation)}. Reporter citations look like '590 U.S. 644' (volume, reporter, page).\nCoverage: ${report.coverage}`);
      }
      const extra_rows = report.rows.length > 1 ? `\n(${report.rows.length - 1} more citation${report.rows.length === 2 ? "" : "s"} in the input; showing the first. Use check_citations for several.)` : "";
      return ok(`${formatRowDetail(row)}${extra_rows}\nCoverage: ${report.coverage}`, { tier: row.tier, citation: row.citation, headline: row.headline, coverage: report.coverage });
    } catch (err) {
      return fail(err);
    }
  },
});
