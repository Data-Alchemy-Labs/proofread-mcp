import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MAX_SUGGEST_QUERY_CHARS, type Client } from "../client.js";
import { ProofreadError } from "../errors.js";
import { formatSuggest, siteLink } from "../suggest_format.js";
import type { SuggestAnswer } from "../types.js";
import { defineTool, fail, ok } from "./tool.js";

export const suggestCases = defineTool({
  name: "suggest_cases",
  title: "Suggest leading Swiss cases for a statute article",
  description:
    "Swiss law only. Give a Swiss federal statute article ('Art. 41 OR', 'art. 41 CO', 'Art. 8 ZGB', 'art. 9 Cst.') or a paragraph that cites one, " +
    "and get the leading Federal Supreme Court cases (BGE/ATF/DTF) the court cites with that article, as cases to read. " +
    "The query needs a statute article: there is no free-text search, and a query without one answers that no article was recognised. " +
    "Results are grouped by field: the article's own field of law first, then other fields where it is also cited, each in the measured ranking order. " +
    "Each row has the citation, date, field, rank, the quoted passage (regeste or consideration), the decision's link, a link to check the citation on proofread.law, " +
    "and any later change of practice (a changed precedent is listed with its flag, never left out; a row without a flag is not evidence that its practice still holds). " +
    "A suggestion has not been checked against the user's sentence; to check a citation, use check_citations. " +
    "The answer comes back in the query's language (German, French or Italian; lang='en' for English). " +
    "During the trial phase it needs a paid-plan or trial API key; each answered query counts as one resolve.",
  inputSchema: {
    query: z.string().min(1).max(MAX_SUGGEST_QUERY_CHARS)
      .describe("A Swiss statute article, e.g. 'Art. 41 OR' or 'art. 9 Cst.', or a paragraph that cites one (up to 20,000 characters)."),
    domain: z.enum(["all", "civil", "criminal", "public", "social"]).default("all")
      .describe("Only this field of law: civil, criminal, public or social. Default all."),
    lang: z.enum(["de", "fr", "it", "en"]).optional().describe("The answer's language: de, fr, it or en. Default: the query's language."),
    k: z.number().int().min(1).max(50).default(10).describe("Rows per section, 1 to 50. Default 10."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ query, domain, lang, k }, { client }, extra) {
    try {
      const answer = await client.suggest(query, { domain, k, ...(lang ? { lang } : {}) }, extra.signal);
      const origin = client.siteOrigin();
      return ok(formatSuggest(answer, origin), structured(answer, origin));
    } catch (err) {
      return suggestFail(err, client);
    }
  },
});

/** The answer without its passages (they are in the text): status, what was read, the sections with each row's facts, links and flags. */
function structured(a: SuggestAnswer, origin: string): Record<string, unknown> {
  return {
    status: a.status,
    language: a.language ?? null,
    read_as: a.read_as ?? null,
    message: a.message ?? null,
    notes: a.notes ?? [],
    understood: (a.understood ?? []).map((x) => ({ label: x.label, indexed: x.indexed ?? null })),
    domain: a.domain ?? null,
    k: a.k ?? null,
    sections: (a.sections ?? []).map((s) => ({
      kind: s.kind,
      title: s.title ?? null,
      collapsed: s.collapsed ?? false,
      empty_note: s.empty_note ?? null,
      results: s.results.map((r) => ({
        rank: r.rank, ref: r.ref, cite: r.cite, date: r.date ?? null, language: r.language ?? null, domain: r.domain ?? null, field: r.field ?? null,
        passage_kind: r.passage_kind ?? null, url: r.url ?? null, check_url: r.check_url ? siteLink(origin, r.check_url) : null,
        practice: (r.practice ?? []).map((f) => ({ kind: f.kind, text: f.text, by: f.by ?? null, url: f.url ?? null })),
      })),
    })),
    about: a.about ?? null,
  };
}

/** The errors this route adds, in plain words; the rest (quota, rate limit, key, network) read as they do for any tool. */
function suggestFail(err: unknown, client: Client): CallToolResult {
  if (!(err instanceof ProofreadError)) return fail(err);
  const origin = client.siteOrigin();
  switch (err.code) {
    case "plan_required": {
      const upgrade = siteLink(origin, typeof err.info.upgrade === "string" ? err.info.upgrade : "/pricing");
      return fail(`proofread.law: ${period(err.message)} Upgrade at ${upgrade}. ` + (client.hasApiKey()
        ? "The billing_link tool gives the account owner a checkout link."
        : "No API key is set: put a paid-plan or trial key in PROOFREAD_API_KEY, or call sign_up and then billing_link."));
    }
    case "too_large":
      return fail("proofread.law: the query is longer than the 20,000-character cap. Send the article, or the paragraph that cites it.");
    case "timeout":
      return fail(`proofread.law timed out: ${err.message}. Try again, or send only the article.`);
    case "suggest_off":
      return fail(`proofread.law: ${period(err.message)} check_citations still checks citations.`);
    case "suggest_unavailable":
      return fail(`proofread.law: ${period(err.message)} Try again later.`);
    default:
      if (err.status === 404) return fail("This proofread.law server does not offer case suggestions (HTTP 404). check_citations still checks citations.");
      return fail(err);
  }
}

function period(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
