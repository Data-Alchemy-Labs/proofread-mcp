import type { PracticeFlag, SuggestAnswer, SuggestResult, SuggestSection } from "./types.js";

/**
 * Full rows (passage, context, flags, links) up to this many characters; the rows after it are listed with their header line and any
 * practice flag only, so a large k stays inside a model's budget and no row, and no flag, is dropped.
 */
export const MAX_SUGGEST_CHARS = 20_000;

/**
 * suggest_cases: the API's own words, in the query's language. The read_as line, the notes (or, for no_article and not_indexed, the
 * message and notes), then each section with its title and numbered rows: cite, date, field, the decision's language, rank; any later
 * change of practice; the quoted passage with its label; the regeste as context for a passage from the reasons; the decision's link
 * and the check link on proofread.law. Ends with `about` (the method and its measured numbers).
 */
export function formatSuggest(answer: SuggestAnswer, origin: string): string {
  const lines: string[] = [];
  if (answer.read_as) lines.push(answer.read_as);
  if (answer.message) lines.push(answer.message);
  for (const note of answer.notes ?? []) lines.push(note);

  const tail = answer.about ? [answer.about] : [];
  const budget = MAX_SUGGEST_CHARS - lines.join("\n").length - tail.join("\n").length;
  const q = quotes(answer.language);
  let used = 0;
  let n = 0;
  let firstShort: number | undefined;
  for (const section of answer.sections ?? []) {
    if (!section.results.length && !section.empty_note) continue; // an empty "other" section is left out, as on the web page
    lines.push(sectionTitle(section));
    if (section.empty_note) lines.push(section.empty_note);
    for (const row of section.results) {
      n += 1;
      const full = rowLines(row, n, origin, q);
      const size = full.join("\n").length + 1;
      if (firstShort === undefined && (n === 1 || used + size <= budget)) {
        lines.push(...full);
        used += size;
      } else {
        firstShort ??= n;
        lines.push(headerLine(row, n), ...(row.practice ?? []).map((f) => `   ${flagText(f)}`));
      }
    }
  }
  if (firstShort !== undefined) {
    const which = firstShort === n ? `Row ${n} is` : `Rows ${firstShort} to ${n} are`;
    lines.push(`${which} listed without passage and links to keep this answer short; the structured result carries their links.`);
  }
  if (!lines.length) lines.push(`proofread.law returned no suggestions for this query (status ${answer.status}).`);
  return [...lines, ...tail].join("\n");
}

/** `Entscheide aus dem Zivilrecht (3):` */
function sectionTitle(s: SuggestSection): string {
  const title = s.title || (s.kind === "home" ? "Decisions from the article's own field" : "Also cited with the article in other fields");
  return `${title} (${s.results.length}):`;
}

/** `1. BGE 144 III 155, 16.04.2018, Zivilrecht, DE, Rang 5` */
function headerLine(r: SuggestResult, n: number): string {
  const facts = [r.cite || r.ref, r.date_display || r.date, r.field, r.language ? r.language.toUpperCase() : undefined, r.rank_label || `rank ${r.rank}`];
  return `${n}. ${facts.filter(Boolean).join(", ")}`;
}

function rowLines(r: SuggestResult, n: number, origin: string, q: [string, string]): string[] {
  const lines = [headerLine(r, n)];
  for (const f of r.practice ?? []) {
    lines.push(`   ${flagText(f)}`);
    for (const line of f.lines ?? []) lines.push(`   ${line}`);
  }
  if (r.passage) lines.push(`   ${labelled(r.passage_label, `${q[0]}${oneLine(r.passage)}${q[1]}`)}`);
  if (r.regeste) lines.push(`   ${labelled(r.regeste_label, `${q[0]}${oneLine(r.regeste)}${q[1]}`)}`);
  if (r.url) lines.push(`   ${r.open_label || "Open the decision"}: ${r.url}`);
  if (r.check_url) lines.push(`   ${r.check_label || "Check this citation"}: ${siteLink(origin, r.check_url)}`);
  return lines;
}

/** `Praxisänderung durch BGE 145 III 1, möglicherweise nur teilweise: https://...` (the decision that changed it). */
function flagText(f: PracticeFlag): string {
  return f.url ? `${f.text}: ${f.url}` : f.text;
}

/** A label that is a sentence ending in a colon ("... Aus der Regeste:") is followed by the quote; a bare label gets the colon. */
function labelled(label: string | null | undefined, quoted: string): string {
  if (!label) return quoted;
  return /:\s*$/.test(label) ? `${label.trimEnd()} ${quoted}` : `${label}: ${quoted}`;
}

/** The quotation marks the report uses: guillemets in German, French and Italian, straight quotes in English. */
function quotes(language: string | undefined): [string, string] {
  return language === "en" ? ['"', '"'] : ["«", "»"];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A path the API gives (check_url, upgrade) as a full link on the site; a full URL is kept as it is. */
export function siteLink(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}
