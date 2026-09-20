import { z } from "zod";
import { formatResolve } from "../resolve_format.js";
import { KEY_NOTE, LIMITS_NOTE, defineTool, fail, ok } from "./tool.js";

export const resolveCitation = defineTool({
  name: "resolve_citation",
  title: "Look up one citation in the register",
  description:
    "Look up a single case citation (for example '590 U.S. 644', or 'Bostock v. Clayton County, 590 U.S. 644 (2020)') in proofread.law's register and answer: " +
    "is there a case at this citation, which one (name, court, date, parallel citations, link), and how complete the register is for that volume. " +
    "This is a register lookup of the citation, not a comparison with the case name you have: if the case it returns is not the one you expected, the citation points elsewhere. " +
    "Statuses: found; ambiguous (several entries, candidates listed); not in the register (a register fact with a coverage qualifier, never proof that the case does not exist); " +
    "cannot verify (a Westlaw/Lexis identifier, or a volume the register cannot see yet); known citation (other opinions cite it, the opinion itself is not held); no citation recognised. " +
    "Use it when one citation is in doubt; use check_citations for prose, and resolve_citations for a list. " +
    LIMITS_NOTE + " Counts against the resolve quota (1,000 a month free), not the check quota. " + KEY_NOTE,
  inputSchema: {
    citation: z.string().min(3).max(500).describe("One citation string. A case name and year around it are fine; only the reporter citation is resolved."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ citation }, { client }, extra) {
    try {
      const result = await client.resolveV1(citation, extra.signal);
      return ok(formatResolve(result), {
        status: result.status,
        cite: result.normalized ?? result.cite,
        case: result.case ? { id: result.case.id, name: result.case.name, court: result.case.court ?? null, date: result.case.date ?? null, url: result.case.url ?? null } : null,
        coverage_statement: result.coverage_statement ?? null,
      });
    } catch (err) {
      return fail(err);
    }
  },
});
