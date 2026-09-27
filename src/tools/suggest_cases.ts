import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MAX_SUGGEST_QUERY_CHARS, type Client } from "../client.js";
import { ProofreadError } from "../errors.js";
import { betaLine, formatSuggest, siteLink } from "../suggest_format.js";
import type { SuggestAnswer } from "../types.js";
import { defineTool, fail, ok } from "./tool.js";

export const suggestCases = defineTool({
  name: "suggest_cases",
  title: "Suggest cases for a Swiss statute article or a US legal sentence (US beta)",
  description:
    "Suggests cases to read, for Swiss law or, as a beta, US law. " +
    "Switzerland: give a Swiss federal statute article ('Art. 41 OR', 'art. 41 CO', 'Art. 8 ZGB', 'art. 9 Cst.') or a paragraph that cites one, " +
    "and get the leading Federal Supreme Court cases (BGE/ATF/DTF) the court cites with that article, as cases to read. " +
    "The Swiss list needs a statute article: there is no free-text search, and a Swiss query without one answers that no article was recognised. " +
    "Federal acts only; cantonal law is not covered. " +
    "The answer is one ranked list, each case labelled with its field of law; the domain filter keeps the same order within one field. " +
    "Each row has the citation, date, field, rank, the quoted passage (regeste or consideration), the decision's link, a link to check the citation on proofread.law, " +
    "and any later change of practice (a changed precedent is listed with its flag, never left out; a row without a flag is not evidence that its practice still holds). " +
    "A Swiss suggestion has not been checked against the user's sentence. " +
    "The Swiss answer comes back in the query's language (German, French or Italian; lang='en' for English). " +
    "United States (beta): give one sentence from the draft that states a rule of law (or a short paragraph, up to 1,500 characters), " +
    "and get up to 3 cases whose own text states it. " +
    "Each case comes with the passage the model matched and the paragraphs before and after it. Read the passage before citing the case. " +
    "With court (the court the brief is filed in, e.g. '9th Cir.' or 'N.D. Cal.'), cases that bind that court come first; without it, Supreme Court cases come first. " +
    "A question, a citation, a heading or a statement about the record gets no list: the answer says what to paste instead. " +
    "Every US answer starts with a beta line with the measured numbers; repeat it to the user. " +
    "jurisdiction='auto' (the default) reads a Swiss article, or German, French or Italian text, as Swiss, and anything else as US. " +
    "A suggestion is a case to read; to check a citation, use check_citations. " +
    "During the trial phase it needs a paid-plan or trial API key. " +
    "A Swiss answer counts as one resolve; a US answer counts as one deep-checked citation (an input that gets no list because it states no rule costs nothing).",
  inputSchema: {
    query: z.string().min(1).max(MAX_SUGGEST_QUERY_CHARS)
      .describe("A Swiss federal statute article, e.g. 'Art. 41 OR' or 'art. 9 Cst.', or a paragraph that cites one (up to 20,000 characters). " +
        "Or, for US law, one sentence that states a rule of law, or a short paragraph (up to 1,500 characters)."),
    court: z.string().max(200).optional()
      .describe("US only: the court the brief is filed in, so cases that bind it come first. It reads a federal court of appeals ('9th Cir.', 'Ninth Circuit', 'ca9'), " +
        "a district court ('N.D. Cal.', 'S.D.N.Y.', 'cand'), or a state or territory name or postal code ('California', 'CA') for the federal court there. " +
        "State courts are not read yet. Leave it out to put Supreme Court cases first."),
    jurisdiction: z.enum(["auto", "us", "ch"]).default("auto")
      .describe("auto (default): a Swiss statute article, or German, French or Italian text, is Swiss; anything else is a US sentence. us or ch sets it."),
    domain: z.enum(["all", "civil", "criminal", "public", "social"]).default("all")
      .describe("Swiss only: only this field of law (civil, criminal, public or social), in the same order as the full list. Default all."),
    lang: z.enum(["de", "fr", "it", "en"]).optional().describe("Swiss only: the answer's language, de, fr, it or en. Default: the query's language. A US answer is in English."),
    k: z.number().int().min(1).max(50).default(10).describe("Swiss only: number of rows, 1 to 50. Default 10. A US answer shows up to 3 cases."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ query, court, jurisdiction, domain, lang, k }, { client }, extra) {
    try {
      // auto is the API's default, so it is not sent; an empty court means no court.
      const options = { ...(court?.trim() ? { court: court.trim() } : {}), ...(jurisdiction !== "auto" ? { jurisdiction } : {}), domain, k, ...(lang ? { lang } : {}) };
      const answer = await client.suggest(query, options, extra.signal);
      const origin = client.siteOrigin();
      return ok(formatSuggest(answer, origin), answer.jurisdiction === "us" ? structuredUs(answer, origin) : structured(answer, origin));
    } catch (err) {
      return suggestFail(err, client);
    }
  },
});

/** The answer without its passages (they are in the text): status, what was read, the counts per field, each row's facts, links and flags. */
function structured(a: SuggestAnswer, origin: string): Record<string, unknown> {
  return {
    jurisdiction: a.jurisdiction ?? "ch",
    status: a.status,
    language: a.language ?? null,
    read_as: a.read_as ?? null,
    filter_note: a.filter_note ?? null,
    message: a.message ?? null,
    notes: a.notes ?? [],
    understood: (a.understood ?? []).map((x) => ({ label: x.label, indexed: x.indexed ?? null })),
    domain: a.domain ?? null,
    k: a.k ?? null,
    counts: a.counts ?? null,
    results: (a.results ?? []).map((r) => ({
      rank: r.rank, ref: r.ref, cite: r.cite, date: r.date ?? null, language: r.language ?? null, domain: r.domain ?? null, field: r.field ?? null,
      home_domain: r.home_domain ?? null, passage_kind: r.passage_kind ?? null, url: r.url ?? null, check_url: r.check_url ? siteLink(origin, r.check_url) : null,
      practice: (r.practice ?? []).map((f) => ({ kind: f.kind, text: f.text, by: f.by ?? null, url: f.url ?? null })),
    })),
    about: a.about ?? null,
  };
}

/** A US answer without its passages and context (they are in the text): the beta line, the refusal or the list's facts, links, flags and support. */
function structuredUs(a: SuggestAnswer, origin: string): Record<string, unknown> {
  return {
    jurisdiction: "us",
    beta: a.beta ?? true,
    beta_note: a.beta_note ? betaLine(a.beta_note, origin) : null,
    status: a.status,
    refusal: a.refusal ? { reason: a.refusal.reason } : null,
    message: a.message ?? null,
    example: a.example ?? null,
    court: a.court ? { id: a.court.id, label: a.court.label, circuit: a.court.circuit ?? null, state: a.court.state ?? null } : null,
    court_note: a.court_note ?? null,
    notes: a.notes ?? [],
    counts: a.counts ?? null,
    results: (a.results ?? []).map((r) => ({
      rank: r.rank, reference: r.reference ?? r.cite, cite: r.cite, cluster_id: r.cluster_id ?? null, date: r.date ?? null, year: r.year ?? null,
      court: r.court ?? null, court_name: r.court_name ?? null, authority: r.authority ?? null, authority_label: r.authority_label ?? null, binding: r.binding ?? null,
      passage_kind: r.passage_kind ?? null, url: r.url ?? null, check_url: r.check_url ? siteLink(origin, r.check_url) : null,
      flags: (r.flags ?? []).map((f) => ({ kind: f.kind, text: f.text })),
      support: r.support ? { relation: r.support.relation ?? null, confidence: r.support.confidence ?? null } : null,
    })),
    not_shown: (a.not_shown ?? []).map((x) => ({ reference: x.reference, cluster_id: x.cluster_id ?? null, reason: x.reason ?? null, text: x.text ?? null })),
    about: a.about ?? null,
  };
}

/** The errors this route adds (Swiss and US), in plain words; the rest (quota, rate limit, key, network) read as they do for any tool. */
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
      return fail("proofread.law: the query is longer than the 20,000-character cap. Send the article or the paragraph that cites it (Swiss law), or one sentence (US law).");
    case "timeout":
      return fail(`proofread.law timed out: ${err.message.replace(/[;,.]?\s*try again\.?\s*$/i, "").trim()}. ` +
        "Try again; a short query is faster (the article alone for Swiss law, one sentence for US law).");
    case "suggest_off":
      return fail(`proofread.law: ${period(err.message)} check_citations still checks citations.`);
    case "suggest_unavailable":
      return fail(err.info.jurisdiction === "us"
        ? `proofread.law: ${period(err.message)} check_citations still checks citations.`
        : `proofread.law: ${period(err.message)} Try again later.`);
    case "bad_court":
      return fail(`proofread.law did not read the court: ${period(err.message)} ` +
        "The court field reads a federal court of appeals (9th Cir., Ninth Circuit, ca9), a district court (N.D. Cal., S.D.N.Y., cand), " +
        "or a state or territory name or postal code (California, CA) for the federal court there. Leave court out to put Supreme Court cases first.");
    case "bad_jurisdiction":
      return fail(`proofread.law: ${period(err.message)} With auto, the default, a Swiss article or German, French or Italian text is read as Swiss, and anything else as US.`);
    case "deep_budget_exhausted":
      return fail("proofread.law: today's budget for model calls is spent, so US suggestions are back tomorrow (UTC). check_citations still checks citations without deep.");
    case "deep_unavailable":
      return fail("proofread.law: US suggestions are unavailable right now because the model provider is refusing requests. Try again in a few minutes.");
    default:
      if (err.status === 404) return fail("This proofread.law server does not offer case suggestions (HTTP 404). check_citations still checks citations.");
      return fail(err);
  }
}

function period(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
