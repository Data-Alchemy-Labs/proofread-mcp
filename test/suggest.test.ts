import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { INSTRUCTIONS } from "../src/server.js";
import { formatSuggest, MAX_SUGGEST_CHARS } from "../src/suggest_format.js";
import { tools } from "../src/tools/index.js";
import type { SuggestAnswer, SuggestResult } from "../src/types.js";
import { connectedClient, connectedClientWith, mockFetch, suggestFixture, textOf } from "./helpers.js";

// Answers in the shape of proofread-law's /v1/suggest (branch suggest-ch 87c651e, app/suggest.py and CONTRACTS.md seam 3): status ok |
// no_article | not_indexed, one list of results in the measured order (a domain filter keeps each row's overall rank and adds filter_note),
// every reader-facing string already worded in the query's language; errors 402 plan_required (paid plans and trials during the trial
// phase), 400 missing_query / bad_domain / bad_lang / bad_k, 413 too_large, 503 suggest_off, 504 timeout.

type Connected = Awaited<ReturnType<typeof connectedClient>>;
let session: Connected | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

const call = (args: Record<string, unknown>) => session!.mcp.callTool({ name: "suggest_cases", arguments: args });
const auth = (i: number) => (session!.calls[i]!.init.headers as Record<string, string>).Authorization;

/** The product's wording rules on every string this server writes: no dashes as punctuation, never "fabricated", no verdict words. */
function expectPlain(text: string): void {
  expect(text).not.toMatch(/[\u2013\u2014]/);
  expect(text.toLowerCase()).not.toMatch(/fabricat|fake|hallucinat|bogus|\bwrong\b|\binvalid\b|\bincorrect\b|bad law/);
}

const FLAG = {
  kind: "practice_changed",
  text: "Praxisänderung durch BGE 145 III 1, möglicherweise nur teilweise",
  lines: ["Regeste: «Änderung der Rechtsprechung zur Legitimation der Angehörigen.»"],
  by: "BGE 145 III 1",
  url: "https://search.bger.ch/ext/eurospider/live/de/php/clir/http/index.php?highlight_docid=atf%3A%2F%2F145-III-1%3Ade&lang=de&type=show_document",
};

/** The de fixture with a later change of practice on its second row. */
function withFlag(): SuggestAnswer {
  const a = suggestFixture("de");
  a.results![1]!.practice = [FLAG];
  return a;
}

describe("suggest_cases: description and schema", () => {
  const tool = tools.find((t) => t.name === "suggest_cases")!;

  it("says Swiss only, that the query needs a statute article, that a suggestion is a case to read and not a check, and points at check_citations", () => {
    const d = tool.description;
    expect(d).toMatch(/^Swiss law only\./);
    expect(d).toContain("The query needs a statute article: there is no free-text search");
    expect(d).toContain("Federal acts only; cantonal law is not covered.");
    expect(d).toContain("as cases to read");
    expect(d).toContain("A suggestion has not been checked against the user's sentence; to check a citation, use check_citations.");
    expect(d).toContain("one ranked list, each case labelled with its field of law; the domain filter keeps the same order within one field");
    expect(d).not.toMatch(/grouped|section/i);
    expect(d).toContain("the quoted passage");
    expect(d).toContain("any later change of practice");
    expect(d).toContain("a row without a flag is not evidence that its practice still holds");
    expect(d).toContain("paid-plan or trial API key");
    expectPlain(tool.title);
    expectPlain(d);
    expect(INSTRUCTIONS).toContain("suggest_cases takes a federal statute article");
  });

  it("refuses a domain, lang or k outside the API's values, an empty query and one past 20,000 characters, without a call", async () => {
    session = await connectedClient({ body: suggestFixture("de") });
    for (const args of [
      { query: "Art. 41 OR", domain: "tax" }, { query: "Art. 41 OR", domain: "Civil" }, { query: "Art. 41 OR", lang: "es" },
      { query: "Art. 41 OR", k: 0 }, { query: "Art. 41 OR", k: 51 }, { query: "Art. 41 OR", k: 2.5 }, { query: "" }, { query: "x".repeat(20_001) }, {},
    ]) {
      expect((await call(args)).isError, JSON.stringify(args).slice(0, 60)).toBe(true);
    }
    expect(session.calls).toHaveLength(0);
  });
});

describe("suggest_cases: the request", () => {
  it("GETs /v1/suggest for a short query with the defaults domain=all and k=10, no lang, and the key", async () => {
    session = await connectedClient({ body: suggestFixture("de") });
    const result = await call({ query: "Art. 41 OR, Art. 97 OR" });
    expect(result.isError).toBeFalsy();
    expect(session.calls[0]?.url).toBe("https://api.test/v1/suggest?q=Art.%2041%20OR%2C%20Art.%2097%20OR&domain=all&k=10");
    expect(session.calls[0]?.init.method).toBe("GET");
    expect(session.calls[0]?.init.body).toBeUndefined();
    expect(auth(0)).toBe("Bearer pl_test_key");
  });

  it("passes domain, lang and k through; a lowercase, dotless query goes as it is (the server reads it)", async () => {
    session = await connectedClient({ body: suggestFixture("filter-de") }, { body: suggestFixture("lowercase") });
    await call({ query: "Art. 41 OR", domain: "civil", lang: "de", k: 3 });
    expect(session.calls[0]?.url).toBe("https://api.test/v1/suggest?q=Art.%2041%20OR&domain=civil&lang=de&k=3");
    const lower = await call({ query: "art 41 or", k: 2 });
    expect(session.calls[1]?.url).toBe("https://api.test/v1/suggest?q=art%2041%20or&domain=all&k=2");
    expect(textOf(lower).split("\n").slice(0, 2)).toEqual(["Gelesen als: Art. 41 OR", "1. BGE 146 IV 76, 13.11.2019, Strafrecht, FR, Rang 1"]);
  });

  it("POSTs a long query (a pasted paragraph) as JSON with the same parameters; 1,500 characters still go as GET", async () => {
    session = await connectedClient({ body: suggestFixture("de") });
    const paragraph = "Die Haftung richtet sich nach Art. 41 OR. ".repeat(40);
    expect(paragraph.length).toBeGreaterThan(1_500);
    await call({ query: paragraph, domain: "criminal", lang: "de", k: 5 });
    expect(session.calls[0]?.url).toBe("https://api.test/v1/suggest");
    expect(session.calls[0]?.init.method).toBe("POST");
    expect((session.calls[0]!.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(session.calls[0]!.init.body))).toEqual({ q: paragraph, domain: "criminal", lang: "de", k: 5 });
    expect(auth(0)).toBe("Bearer pl_test_key");

    await call({ query: paragraph.slice(0, 1_500) });
    expect(session.calls[1]?.init.method).toBe("GET");
    expect(session.calls[1]?.url).toMatch(/^https:\/\/api\.test\/v1\/suggest\?q=Die%20Haftung/);
    await call({ query: paragraph.slice(0, 1_501) });
    expect(session.calls[2]?.init.method).toBe("POST");
    expect(JSON.parse(String(session.calls[2]!.init.body))).toEqual({ q: paragraph.slice(0, 1_501), domain: "all", k: 10 });
  });

  it("without a key the request goes out without Authorization (the anonymous tier applies)", async () => {
    session = await connectedClientWith({}, { body: suggestFixture("de") });
    await call({ query: "Art. 41 OR" });
    expect(auth(0)).toBeUndefined();
  });
});

describe("suggest_cases: the answer", () => {
  it("prints the API's words: read_as, then one numbered list in the measured order (cite, date, field, language, rank, passage, links), then about", async () => {
    const fixture = suggestFixture("de");
    session = await connectedClient({ body: fixture });
    const result = await call({ query: "Art. 41 OR, Art. 97 OR", k: 3 });
    const text = textOf(result);
    const lines = text.split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "Gelesen als: Art. 41 OR, Art. 97 OR",
      "1. BGE 146 IV 76, 13.11.2019, Strafrecht, FR, Rang 1",
      "   Das Bundesgericht zitiert diesen Entscheid zusammen mit Art. 41 OR; der Entscheid selbst nennt den Artikel nicht. Aus der Regeste: «a) Art. 110 Abs. 1 StGB; " +
        "Art. 118, 121 Abs. 1 und 382 Abs. 1 StPO; Legitimation der Angehörigen einer verstorbenen geschädigten Person zur Anfechtung einer Verfahrenseinstellung. " +
        "Die Angehörigen der verstorbenen geschädigten Person, die sich im Vorverfahren rechtsgültig als Privatklägerschaft konstituiert haben, können über ein " +
        "rechtlich geschütztes Interesse im Sinne von Art. …»",
      "   Entscheid öffnen: https://search.bger.ch/ext/eurospider/live/de/php/clir/http/index.php?highlight_docid=atf%3A%2F%2F146-IV-76%3Ade&lang=de&type=show_document",
      "   Zitat prüfen: https://api.test/?cite=Art.%2041%20OR%3B%20BGE%20146%20IV%2076#check",
    ]);
    expect(lines.filter((l) => /^\d+\. /.test(l))).toEqual([
      "1. BGE 146 IV 76, 13.11.2019, Strafrecht, FR, Rang 1",
      "2. BGE 141 IV 1, 04.12.2014, Strafrecht, FR, Rang 2",
      "3. BGE 137 IV 246, 15.07.2011, Strafrecht, DE, Rang 3",
    ]);
    expect(lines).toHaveLength(1 + 3 * 4 + 1);
    expect(lines.at(-1)).toBe(fixture.about);
    expectPlain(text);

    const sc = result.structuredContent as { results: Array<Record<string, unknown>> };
    expect(sc).toMatchObject({ status: "ok", language: "de", read_as: "Gelesen als: Art. 41 OR, Art. 97 OR", filter_note: null, message: null, domain: "all", k: 3,
      counts: { candidates: 93, by_field: { civil: 60, criminal: 24, public: 7, social: 2 }, shown: 3 } });
    expect(sc).not.toHaveProperty("sections");
    expect(sc.results.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(sc.results[0]).toEqual({
      rank: 1, ref: "BGE 146 IV 76", cite: "BGE 146 IV 76", date: "2019-11-13", language: "fr", domain: "criminal", field: "Strafrecht", home_domain: false,
      passage_kind: "regeste_start",
      url: "https://search.bger.ch/ext/eurospider/live/de/php/clir/http/index.php?highlight_docid=atf%3A%2F%2F146-IV-76%3Ade&lang=de&type=show_document",
      check_url: "https://api.test/?cite=Art.%2041%20OR%3B%20BGE%20146%20IV%2076#check", practice: [],
    });
  });

  it("French: the same list in the query's language", async () => {
    session = await connectedClient({ body: suggestFixture("fr") });
    const lines = textOf(await call({ query: "art. 41 CO", k: 3 })).split("\n");
    expect(lines[0]).toBe("Lu comme: art. 41 CO");
    expect(lines[1]).toBe("1. ATF 146 IV 76, 13.11.2019, droit pénal, FR, Rang 1");
    expect(lines[2]).toMatch(/^ {3}Le Tribunal fédéral cite cet arrêt avec l'art\. 41 CO, que l'arrêt lui-même ne mentionne pas\. Extrait du regeste: «a\) Art\. 110 al\. 1 CP;/);
    expect(lines[3]).toMatch(/^ {3}Ouvrir l'arrêt: https:\/\/search\.bger\.ch\//);
    expect(lines[4]).toBe("   Vérifier cette citation: https://api.test/?cite=art.%2041%20CO%3B%20ATF%20146%20IV%2076#check");
    expect(lines.at(-1)).toMatch(/^Les suggestions sont des arrêts de principe publiés \(ATF\)\./);
  });

  it("a domain filter: the filter note under read_as, rows numbered in this list with their overall rank, a reasons passage with the regeste as context", async () => {
    session = await connectedClient({ body: suggestFixture("filter-de") });
    const result = await call({ query: "Art. 41 OR", domain: "civil", k: 3 });
    const lines = textOf(result).split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "Gelesen als: Art. 41 OR",
      "Filter: Zivilrecht. Die Reihenfolge ist dieselbe wie in der ganzen Liste.",
      "1. BGE 132 III 122, 13.09.2005, Zivilrecht, FR, Rang 7",
    ]);
    expect(lines.filter((l) => /^\d+\. /.test(l))).toEqual([
      "1. BGE 132 III 122, 13.09.2005, Zivilrecht, FR, Rang 7",
      "2. BGE 144 III 155, 16.04.2018, Zivilrecht, DE, Rang 9",
      "3. BGE 148 III 11 E. 3.2, 01.11.2021, Zivilrecht, DE, Rang 10",
    ]);
    const i = lines.indexOf("3. BGE 148 III 11 E. 3.2, 01.11.2021, Zivilrecht, DE, Rang 10");
    expect(lines[i + 1]).toMatch(/^ {3}E\. 3\.2: «… ausschliesslich dem Gläubiger- oder Aktionärsschutz/);
    expect(lines[i + 2]).toMatch(/^ {3}Worum es im Entscheid geht \(Regeste\): «Art\. 754 ff\. OR; aktienrechtliche Verantwortlichkeit;/);
    expect(lines[i + 3]).toMatch(/^ {3}Entscheid öffnen: https:\/\/search\.bger\.ch\//);
    expect(lines[i + 4]).toBe("   Zitat prüfen: https://api.test/?cite=Art.%2041%20OR%3B%20BGE%20148%20III%2011%20E.%203.2#check");
    const sc = result.structuredContent as { filter_note: string; domain: string; results: Array<{ rank: number; domain: string }> };
    expect(sc.filter_note).toBe("Filter: Zivilrecht. Die Reihenfolge ist dieselbe wie in der ganzen Liste.");
    expect(sc.domain).toBe("civil");
    expect(sc.results.map((r) => [r.rank, r.domain])).toEqual([[7, "civil"], [9, "civil"], [10, "civil"]]);
  });

  it("a filter that leaves no rows: read_as, the filter note, the API's message, then about; an answer, not an error", async () => {
    const fixture = suggestFixture("filter-empty-fr");
    session = await connectedClient({ body: fixture });
    const result = await call({ query: "art. 41 CO", domain: "social", k: 3 });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe([
      "Lu comme: art. 41 CO",
      "Filtre: droit des assurances sociales. L'ordre est celui de la liste complète.",
      "Aucune suggestion pour art. 41 CO ne relève du droit des assurances sociales. Sans filtre, la liste complète s'affiche.",
      fixture.about,
    ].join("\n"));
    expect(result.structuredContent).toMatchObject({ status: "ok", domain: "social", results: [], counts: { by_field: { social: 0 }, shown: 0 } });
  });

  it("a later change of practice is printed with its text, lines and link, right under the row it concerns", async () => {
    session = await connectedClient({ body: withFlag() });
    const result = await call({ query: "Art. 41 OR, Art. 97 OR", k: 3 });
    const lines = textOf(result).split("\n");
    const i = lines.indexOf("2. BGE 141 IV 1, 04.12.2014, Strafrecht, FR, Rang 2");
    expect(lines.slice(i + 1, i + 3)).toEqual([
      `   Praxisänderung durch BGE 145 III 1, möglicherweise nur teilweise: ${FLAG.url}`,
      "   Regeste: «Änderung der Rechtsprechung zur Legitimation der Angehörigen.»",
    ]);
    expect(lines[i + 3]).toMatch(/^ {3}Das Bundesgericht zitiert diesen Entscheid/);
    const sc = result.structuredContent as { results: Array<{ practice: unknown[] }> };
    expect(sc.results[1]!.practice).toEqual([{ kind: "practice_changed", text: FLAG.text, by: "BGE 145 III 1", url: FLAG.url }]);
  });

  it("no_article: the API's message (federal acts only), as an answer and not an error", async () => {
    const fixture = suggestFixture("noarticle");
    session = await connectedClient({ body: fixture });
    const result = await call({ query: "nothing here" });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe("In der Eingabe wurde kein Artikel eines Bundesgesetzes erkannt. Nennen Sie einen, zum Beispiel Art. 41 OR. " +
      "Die Vorschläge betreffen nur Bundesrecht, keine kantonalen Erlasse.");
    expect(result.structuredContent).toMatchObject({ status: "no_article", read_as: null, message: fixture.message, results: [], about: null });
  });

  it("no_article with a note (the query cites a decision), and not_indexed: read_as, the message, then the notes", async () => {
    const noArticle = { ...suggestFixture("noarticle"), notes: ["Die Eingabe zitiert einen Entscheid. Zitate prüfen Sie mit der Zitatprüfung."] };
    const notIndexed = {
      ...suggestFixture("noarticle"), status: "not_indexed", read_as: "Gelesen als: Art. 999 OR",
      understood: [{ law: "OR", art: "999", para: null, label: "Art. 999 OR", indexed: false }],
      message: "Der Index enthält keinen Leitentscheid (BGE) zu Art. 999 OR.",
    };
    session = await connectedClient({ body: noArticle }, { body: notIndexed });
    expect(textOf(await call({ query: "BGE 132 III 122" }))).toBe(`${noArticle.message}\nDie Eingabe zitiert einen Entscheid. Zitate prüfen Sie mit der Zitatprüfung.`);
    const result = await call({ query: "Art. 999 OR" });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe("Gelesen als: Art. 999 OR\nDer Index enthält keinen Leitentscheid (BGE) zu Art. 999 OR.");
    expect(result.structuredContent).toMatchObject({ status: "not_indexed", understood: [{ label: "Art. 999 OR", indexed: false }] });
  });

  it("notes follow read_as and the filter note; English uses straight quotes", () => {
    const a = suggestFixture("filter-de");
    a.language = "en";
    a.read_as = "Read as: Art. 41 OR";
    a.filter_note = "Filter: civil law. The order is the same as in the full list.";
    a.notes = ["The ranking covers the whole article; the paragraph you named is shown but does not change the order."];
    a.results = a.results!.slice(0, 1);
    const lines = formatSuggest(a, "https://proofread.law").split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "Read as: Art. 41 OR",
      "Filter: civil law. The order is the same as in the full list.",
      "The ranking covers the whole article; the paragraph you named is shown but does not change the order.",
      "1. BGE 132 III 122, 13.09.2005, Zivilrecht, FR, Rang 7",
    ]);
    expect(lines[4]).toMatch(/^ {3}Regeste: "Rechtmässigkeit von im Arbeitskampf/);
    expect(lines[6]).toBe("   Zitat prüfen: https://proofread.law/?cite=Art.%2041%20OR%3B%20BGE%20132%20III%20122#check");
  });

  it("k=50: rows past the budget keep their header line and practice flag; none is dropped", () => {
    const a = suggestFixture("de");
    const base = a.results![0]!;
    a.results = Array.from({ length: 50 }, (_, i): SuggestResult => ({
      ...base, rank: i + 1, cite: `BGE ${100 + i} III ${i + 1}`, rank_label: `Rang ${i + 1}`, passage: "Regeste. ".repeat(60),
    }));
    a.results[45]!.practice = [FLAG];
    const text = formatSuggest(a, "https://proofread.law");
    for (let r = 1; r <= 50; r++) expect(text).toContain(`, Rang ${r}\n`);
    expect(text).toContain(`\n   ${FLAG.text}: ${FLAG.url}\n`);
    expect(text.length).toBeLessThan(MAX_SUGGEST_CHARS + 50 * 120);
    const note = text.split("\n").find((l) => l.startsWith("Rows "))!;
    expect(note).toMatch(/^Rows \d+ to 50 are listed without passage and links to keep this answer short; the structured result carries their links\.$/);
    expect(text.split("\n")[2]).toMatch(/^ {3}Das Bundesgericht zitiert diesen Entscheid .* «Regeste\./); // the first rows are full
    expect(text.split("\n").at(-1)).toBe(a.about);
    expectPlain(note);
  });
});

describe("suggest_cases: errors", () => {
  const planRequired = {
    status: 402,
    body: { error: { code: "plan_required", message: "case suggestions are available on paid plans during the trial phase", plan: "free", feature: "suggest", signed_in: true, upgrade: "/pricing" } },
  };

  it("402 plan_required: the API's message and the upgrade page, and with a key the billing_link hint", async () => {
    session = await connectedClient(planRequired);
    const result = await call({ query: "Art. 41 OR" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("proofread.law: case suggestions are available on paid plans during the trial phase. Upgrade at https://api.test/pricing. " +
      "The billing_link tool gives the account owner a checkout link.");
    expectPlain(textOf(result));
  });

  it("402 plan_required without a key says no key is set", async () => {
    session = await connectedClientWith({}, { status: 402, body: { error: { ...planRequired.body.error, plan: "anon", signed_in: false } } });
    expect(textOf(await call({ query: "Art. 41 OR" }))).toBe("proofread.law: case suggestions are available on paid plans during the trial phase. Upgrade at https://api.test/pricing. " +
      "No API key is set: put a paid-plan or trial key in PROOFREAD_API_KEY, or call sign_up and then billing_link.");
  });

  it("400s from the API read as the API's message", async () => {
    session = await connectedClient(
      { status: 400, body: { error: { code: "missing_query", message: "send ?q=Art. 41 OR (an article, or a paragraph that cites one)" } } },
      { status: 400, body: { error: { code: "bad_domain", message: "domain must be all, civil, criminal, public or social" } } },
      { status: 400, body: { error: { code: "bad_k", message: "k must be 1 to 50" } } });
    expect(textOf(await call({ query: "   " }))).toBe("proofread.law: send ?q=Art. 41 OR (an article, or a paragraph that cites one).");
    expect(textOf(await call({ query: "Art. 41 OR" }))).toBe("proofread.law: domain must be all, civil, criminal, public or social.");
    expect(textOf(await call({ query: "Art. 41 OR" }))).toBe("proofread.law: k must be 1 to 50.");
  });

  it("413, 429 (quota and rate), 503 (off and unavailable), 504, 404 and network failures each read as a plain sentence", async () => {
    session = await connectedClient(
      { status: 413, body: { error: { code: "too_large", message: "the query is longer than 20000 characters" } } },
      { status: 429, body: { error: { code: "quota_exceeded", message: "resolves used", plan: "solo", used: 1000, limit: 1000, upgrade: "/pricing" } } },
      { status: 429, body: { error: { code: "rate_limited", message: "60 requests per hour on the Solo plan; try again in 100 s", retry_after: 100 } } },
      { status: 503, body: { error: { code: "suggest_off", message: "case suggestions are switched off" } } },
      { status: 503, body: { error: { code: "suggest_unavailable", message: "case suggestions are not available on this register" } } },
      { status: 504, body: { error: { code: "timeout", message: "the suggestions did not finish in time" } } },
      { status: 404, body: { detail: "Not Found" } },
      { throws: new TypeError("fetch failed") });
    const texts: string[] = [];
    for (let i = 0; i < 8; i++) {
      const result = await call({ query: "Art. 41 OR" });
      expect(result.isError).toBe(true);
      texts.push(textOf(result));
    }
    expect(texts).toEqual([
      "proofread.law: the query is longer than the 20,000-character cap. Send the article, or the paragraph that cites it.",
      "proofread.law monthly allowance used (1000 of 1000). Upgrade at /pricing. The billing_link tool gives the account owner a checkout link; a paid-plan API key lifts the free-tier limits.",
      "proofread.law rate limit: 60 requests per hour on the Solo plan; try again in 100 s. Retry after 100 s.",
      "proofread.law: case suggestions are switched off. check_citations still checks citations.",
      "proofread.law: case suggestions are not available on this register. Try again later.",
      "proofread.law timed out: the suggestions did not finish in time. Try again, or send only the article.",
      "This proofread.law server does not offer case suggestions (HTTP 404). check_citations still checks citations.",
      "Could not reach https://api.test: fetch failed",
    ]);
    for (const t of texts) expectPlain(t);
  });
});

describe("client: suggest", () => {
  const cfg = { baseUrl: "https://api.test", apiKey: "pl_k" };

  it("an answer without a status or with results of another shape is a clear error", async () => {
    const shape = async (body: unknown) => (await createClient(cfg, mockFetch({ body }).fetch).suggest("Art. 41 OR").catch((e) => e)).message as string;
    expect(await shape({ results: [] })).toContain("unexpected shape (no status field)");
    expect(await shape({ status: "ok", results: {} })).toContain("unexpected shape (results is not a list)");
    expect(await shape({ status: "ok", results: [{ rank: 1 }] })).toContain("unexpected shape (a result without a cite)");
  });

  it("refuses a query past 20,000 characters before calling", async () => {
    const { fetch, calls } = mockFetch({ body: suggestFixture("de") });
    const err = await createClient(cfg, fetch).suggest("x".repeat(20_001)).catch((e) => e);
    expect(err.code).toBe("too_large");
    expect(calls).toHaveLength(0);
  });

  it("a short query that would make a long URL (many accented characters) goes as POST", async () => {
    const { fetch, calls } = mockFetch({ body: suggestFixture("de") });
    await createClient(cfg, fetch).suggest("ä".repeat(1_000), { k: 3 });
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ q: "ä".repeat(1_000), k: 3 });
  });

  it("siteOrigin is the base URL's origin, which the check links are joined to", () => {
    expect(createClient({ baseUrl: "https://proofread.law" }).siteOrigin()).toBe("https://proofread.law");
    expect(createClient({ baseUrl: "http://127.0.0.1:8000/api" }).siteOrigin()).toBe("http://127.0.0.1:8000");
  });
});
