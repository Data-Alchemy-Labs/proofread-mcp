import { z } from "zod";
import { MAX_BATCH_CITES } from "../client.js";
import { formatResolveBatch } from "../resolve_format.js";
import { LIMITS_NOTE, defineTool, fail, ok } from "./tool.js";

export const resolveCitations = defineTool({
  name: "resolve_citations",
  title: "Look up a list of citations in the register",
  description:
    "Look up up to 500 case citation strings in proofread.law's register in one call and get one line per citation, in input order: " +
    "found (the case, court, date, link), ambiguous, not in the register (a register fact with a coverage qualifier, never proof that the case does not exist), " +
    "cannot verify (Westlaw/Lexis identifier, or a volume the register cannot see yet), known citation, or no citation recognised. " +
    "Use it for a table of authorities or any list of citations you already have; use check_citations for prose (it also checks names and quotations). " +
    LIMITS_NOTE + " Each citation counts against the resolve quota (1,000 a month free), not the check quota.",
  inputSchema: {
    cites: z.array(z.string().min(1).max(500)).min(1).max(MAX_BATCH_CITES).describe("Citation strings, one per entry, up to 500."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ cites }, { client }, extra) {
    try {
      const batch = await client.resolveBatch(cites, extra.signal);
      return ok(formatResolveBatch(batch), {
        results: batch.results.map((r) => ({ cite: r.normalized ?? r.cite, status: r.status, case: r.case ? { id: r.case.id, name: r.case.name, url: r.case.url ?? null } : null })),
        coverage_statement: batch.coverage_statement,
      });
    } catch (err) {
      return fail(err);
    }
  },
});
