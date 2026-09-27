import type { PracticeFlag, SuggestAnswer, SuggestFlag, SuggestResult } from "./types.js";

/**
 * Full rows (passage, context, flags, links) up to this many characters; the rows after it are listed with their header line and any
 * practice flag only, so a large k stays inside a model's budget and no row, and no flag, is dropped.
 */
export const MAX_SUGGEST_CHARS = 20_000;
/** US: each neighbouring paragraph (Before, After) is cut to about this many characters, on the side away from the passage. */
export const US_CONTEXT_CHARS = 600;
/** US: a matched paragraph longer than this (rare) is cut around the sentence the model quoted, so one row cannot fill the budget. */
export const US_PASSAGE_CHARS = 6_000;
/** Where the beta line's "/measurements" points: the section with the US suggestion numbers. */
export const US_MEASUREMENTS_PATH = "/measurements#suggestions";

/**
 * suggest_cases: the API's own words, in the query's language. The read_as line, the filter note, the message (no_article, not_indexed,
 * or a filter that leaves no rows), the notes, then one numbered list in the measured order: cite, date, field, the decision's language,
 * rank (the overall position, which a filter keeps); any later change of practice; the quoted passage with its label; the regeste as
 * context for a passage from the reasons; the decision's link and the check link on proofread.law. Ends with `about` (the method and
 * its measured numbers).
 */
export function formatSuggest(answer: SuggestAnswer, origin: string): string {
  if (answer.jurisdiction === "us") return formatSuggestUs(answer, origin);
  const lines: string[] = [];
  if (answer.read_as) lines.push(answer.read_as);
  if (answer.filter_note) lines.push(answer.filter_note);
  if (answer.message) lines.push(answer.message);
  for (const note of answer.notes ?? []) lines.push(note);

  const tail = answer.about ? [answer.about] : [];
  const q = quotes(answer.language);
  pushRows(lines, tail, answer.results ?? [], (row, n) => rowLines(row, n, origin, q),
    (row, n) => [headerLine(row, n), ...(row.practice ?? []).map((f) => `   ${flagText(f)}`)]);
  if (!lines.length) lines.push(`proofread.law returned no suggestions for this query (status ${answer.status}).`);
  return [...lines, ...tail].join("\n");
}

/**
 * suggest_cases, United States (a BETA), in English: the beta line first (with the measurements link in full); a refused input gets the
 * API's message and its example sentence; otherwise the court note, the message (no case passed the check), the notes (candidates not
 * checked in time, a case left out because a later court overruled it), then up to 3 numbered rows: reference, court, year, what binds
 * the court given; the citator's flags; a separate opinion's note; the passage the model matched; the paragraphs before and after it,
 * each cut to about US_CONTEXT_CHARS; the opinion's link and the check link on proofread.law. Ends with `about` (how the list is made).
 */
export function formatSuggestUs(answer: SuggestAnswer, origin: string): string {
  const lines: string[] = [];
  if (answer.beta_note) lines.push(`Beta: ${betaLine(answer.beta_note, origin)}`);
  const tail = answer.about ? [answer.about] : [];
  if (answer.status === "refused") {
    if (answer.message) lines.push(answer.message);
    if (answer.example) lines.push(`For example: "${oneLine(answer.example)}"`);
  } else {
    if (answer.court_note) lines.push(answer.court_note);
    if (answer.message) lines.push(answer.message);
    for (const note of answer.notes ?? []) lines.push(note);
    pushRows(lines, tail, answer.results ?? [], (row, n) => usRowLines(row, n, origin),
      (row, n) => [usHeaderLine(row, n), ...(row.flags ?? []).map((f) => `   ${flagText(f)}`)]);
  }
  if (!lines.length) lines.push(`proofread.law returned no suggestions for this query (status ${answer.status}).`);
  return [...lines, ...tail].join("\n");
}

/** The beta line with its "/measurements" as a full link to the suggestion numbers; a full URL in it is kept as it is. */
export function betaLine(note: string, origin: string): string {
  return note.replace(/(^|[\s(])\/measurements(?:#[\w-]*)?(?=$|[\s).,;:])/g, (_, before: string) => `${before}${siteLink(origin, US_MEASUREMENTS_PATH)}`);
}

/**
 * The rows in order, full up to the budget left by the lines above and the tail; from the first row that does not fit, each row gets its
 * short form (header and flags), and a closing line says which rows those are. The first row is always full; no row is dropped.
 */
function pushRows(lines: string[], tail: string[], rows: SuggestResult[], full: (r: SuggestResult, n: number) => string[],
  short: (r: SuggestResult, n: number) => string[]): void {
  const budget = MAX_SUGGEST_CHARS - lines.join("\n").length - tail.join("\n").length;
  let used = 0;
  let firstShort: number | undefined;
  rows.forEach((row, i) => {
    const n = i + 1;
    const rowFull = full(row, n);
    const size = rowFull.join("\n").length + 1;
    if (firstShort === undefined && (n === 1 || used + size <= budget)) {
      lines.push(...rowFull);
      used += size;
    } else {
      firstShort ??= n;
      lines.push(...short(row, n));
    }
  });
  if (firstShort !== undefined) {
    const which = firstShort === rows.length ? `Row ${firstShort} is` : `Rows ${firstShort} to ${rows.length} are`;
    lines.push(`${which} listed without passage and links to keep this answer short; the structured result carries their links.`);
  }
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

/** `Praxisänderung durch BGE 145 III 1, möglicherweise nur teilweise: https://...` (the decision that changed it). A US flag has no link. */
function flagText(f: PracticeFlag | SuggestFlag): string {
  return typeof f.url === "string" && f.url ? `${f.text}: ${f.url}` : f.text;
}

/**
 * `1. Ashcroft v. Iqbal, 556 U.S. 662 (2009), Supreme Court, 2009, Binding here (Supreme Court)`: missing parts are left out, and so is an
 * authority label that only repeats the court's name (with no court given, a Supreme Court case is labelled "Supreme Court").
 */
function usHeaderLine(r: SuggestResult, n: number): string {
  const label = r.authority_label && r.authority_label !== r.court_name ? r.authority_label : undefined;
  const facts = [r.reference || r.cite, r.court_name, r.year || (r.date ? r.date.slice(0, 4) : undefined), label];
  return `${n}. ${facts.filter(Boolean).join(", ")}`;
}

function usRowLines(r: SuggestResult, n: number, origin: string): string[] {
  const lines = [usHeaderLine(r, n)];
  for (const f of r.flags ?? []) lines.push(`   ${flagText(f)}`);
  if (r.opinion_note) lines.push(`   ${r.opinion_note}`);
  if (r.passage) lines.push(`   ${labelled(r.passage_label || "The passage we matched", `"${cutPassage(r.passage, r.quote)}"`)}`);
  if (r.context?.before) lines.push(`   Before: "${keepEnd(r.context.before, US_CONTEXT_CHARS)}"`);
  if (r.context?.after) lines.push(`   After: "${keepStart(r.context.after, US_CONTEXT_CHARS)}"`);
  if (r.url) lines.push(`   ${r.open_label || "Read the opinion"}: ${r.url}`);
  if (r.check_url) lines.push(`   ${r.check_label || "Check this citation"}: ${siteLink(origin, r.check_url)}`);
  return lines;
}

/** The paragraph after the passage: its first `max` characters or so, cut at a word, then "...". */
function keepStart(text: string, max: number): string {
  const t = oneLine(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** The paragraph before the passage: "..." then its last `max` characters or so, cut at a word, so the words next to the passage stay. */
function keepEnd(text: string, max: number): string {
  const t = oneLine(text);
  if (t.length <= max) return t;
  const cut = t.slice(t.length - max);
  const space = cut.indexOf(" ");
  return `...${(space >= 0 && space < max / 2 ? cut.slice(space + 1) : cut).trimStart()}`;
}

/** The matched paragraph whole; past US_PASSAGE_CHARS, a window that starts a little before the sentence the model quoted. */
function cutPassage(passage: string, quote: string | null | undefined): string {
  const t = oneLine(passage);
  if (t.length <= US_PASSAGE_CHARS) return t;
  const at = quote ? t.indexOf(oneLine(quote).slice(0, 80)) : -1;
  const start = at > 0 ? Math.max(0, Math.min(at - 500, t.length - US_PASSAGE_CHARS)) : 0;
  const from = start > 0 ? t.indexOf(" ", start) + 1 || start : 0;
  const window = keepStart(t.slice(from), US_PASSAGE_CHARS);
  return from > 0 ? `...${window}` : window;
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
