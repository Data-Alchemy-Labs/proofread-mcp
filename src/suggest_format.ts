import type { PracticeFlag, SuggestAnswer, SuggestResult } from "./types.js";

/**
 * Full rows (passage, context, flags, links) up to this many characters; the rows after it are listed with their header line and any
 * practice flag only, so a large k stays inside a model's budget and no row, and no flag, is dropped.
 */
export const MAX_SUGGEST_CHARS = 20_000;

/**
 * suggest_cases: the API's own words, in the query's language. The read_as line, the filter note, the message (no_article, not_indexed,
 * or a filter that leaves no rows), the notes, then one numbered list in the measured order: cite, date, field, the decision's language,
 * rank (the overall position, which a filter keeps); any later change of practice; the quoted passage with its label; the regeste as
 * context for a passage from the reasons; the decision's link and the check link on proofread.law. Ends with `about` (the method and
 * its measured numbers).
 */
export function formatSuggest(answer: SuggestAnswer, origin: string): string {
  const lines: string[] = [];
  if (answer.read_as) lines.push(answer.read_as);
  if (answer.filter_note) lines.push(answer.filter_note);
  if (answer.message) lines.push(answer.message);
  for (const note of answer.notes ?? []) lines.push(note);

  const tail = answer.about ? [answer.about] : [];
  const budget = MAX_SUGGEST_CHARS - lines.join("\n").length - tail.join("\n").length;
  const q = quotes(answer.language);
  const rows = answer.results ?? [];
  let used = 0;
  let firstShort: number | undefined;
  rows.forEach((row, i) => {
    const n = i + 1;
    const full = rowLines(row, n, origin, q);
    const size = full.join("\n").length + 1;
    if (firstShort === undefined && (n === 1 || used + size <= budget)) {
      lines.push(...full);
      used += size;
    } else {
      firstShort ??= n;
      lines.push(headerLine(row, n), ...(row.practice ?? []).map((f) => `   ${flagText(f)}`));
    }
  });
  if (firstShort !== undefined) {
    const which = firstShort === rows.length ? `Row ${firstShort} is` : `Rows ${firstShort} to ${rows.length} are`;
    lines.push(`${which} listed without passage and links to keep this answer short; the structured result carries their links.`);
  }
  if (!lines.length) lines.push(`proofread.law returned no suggestions for this query (status ${answer.status}).`);
  return [...lines, ...tail].join("\n");
}

/** `1. BGE 146 IV 76, 13.11.2019, Strafrecht, FR, Rang 1`: the position in this list, and the rank in the full list. */
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
