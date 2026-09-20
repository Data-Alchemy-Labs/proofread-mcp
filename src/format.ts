import type { Report, Row, Tier } from "./types.js";

/** The words a user sees per tier (PRODUCT.md): say what was checked and what was found, never a verdict on the author. */
export const TIER_WORD: Record<Tier, string> = {
  red: "CHECK THIS",
  orange: "CANNOT VERIFY",
  green: "FOUND",
  white: "DEEP CHECK",
};

/** Compact output stays inside a model's budget; the full list is one render_report call away. */
export const MAX_COMPACT_CHARS = 12_000;
const PASSAGE_CHARS = 300;

/**
 * A compact, model-friendly view of a report: the coverage statement first, then the counts, then one line per row that needs a human
 * (red, then orange, then deep-check rows whose passage was not confirmed or states the opposite), then the count of found rows.
 * Westlaw/Lexis identifiers are collapsed into one line, as on the site. Long lists are cut at MAX_COMPACT_CHARS.
 */
export function formatReport(report: Report, reportId?: string): string {
  const s = report.summary;
  const deep = report.mode === "deep";
  const lines: string[] = [`Coverage: ${report.coverage}`];

  if (s.citations === 0 || report.rows.length === 0) {
    lines.push("No case citations were recognised in the text. Reporter citations look like '590 U.S. 644' (volume, reporter, page).");
    lines.push(`Storage: ${report.storage}`);
    return lines.join("\n");
  }

  const rows = report.rows;
  const red = rows.filter((r) => r.tier === "red");
  const orange = rows.filter((r) => r.tier === "orange");
  const ids = orange.filter((r) => r.reason === "database_id");
  const white = rows.filter((r) => r.tier === "white");
  const found = rows.filter((r) => r.tier === "green" || r.tier === "white");
  const support = countSupport(white);
  const review = white.filter((r) => r.support?.status === "opposite" || r.support?.status === "not_confirmed");

  lines.push(
    `Summary: ${plural(s.citations, "citation")}, ${plural(s.rows, "row")}. ` +
      `Check this (red): ${red.length}. Cannot verify (orange): ${orange.length}` +
      (ids.length ? `, of which ${plural(ids.length, "Westlaw/Lexis identifier")}` : "") +
      `. Found (green): ${found.length}.` +
      (deep ? ` Deep-checked (white): ${white.length}: ${support.confirmed} confirmed, ${support.likely} likely, ${support.not_confirmed} not confirmed, ${support.opposite} opposite` +
        (support.not_checked ? `, ${support.not_checked} not checked` : "") + "." : ""),
  );

  // Flagged rows in tier order: red, orange (identifiers collapsed at the end of orange), then deep-check rows to review.
  const flagged: string[] = [
    ...red.map(formatRowLine),
    ...orange.filter((r) => r.reason !== "database_id").map(formatRowLine),
    ...(ids.length ? [databaseIdsLine(ids)] : []),
    ...review.filter((r) => r.support?.status === "opposite").map(formatRowLine),
    ...review.filter((r) => r.support?.status === "not_confirmed").map(formatRowLine),
  ];
  const tail: string[] = [];
  tail.push(`Found: ${plural(found.length, "row")} resolved to a case in the register` +
    (deep ? `; ${support.confirmed} of them confirmed by the deep check (a passage states the proposition)` : "") + ".");
  if (deep) {
    tail.push("Deep check rows are a review queue, not a verdict: confirm the passage yourself before relying on it." +
      (support.likely ? ` ${plural(support.likely, "row")} marked likely (a passage may state this, lower confidence) are listed by render_report.` : ""));
  }
  const closing: string[] = [];
  if (reportId) closing.push(`Report id: ${reportId} (give it to render_report for the full markdown report).`);
  if (report.elapsed_s !== undefined) closing.push(`Elapsed: ${report.elapsed_s} s.`);
  if (closing.length) tail.push(closing.join(" "));
  tail.push(`Storage: ${report.storage}`);

  if (flagged.length === 0) {
    lines.push("Flagged rows: none.");
  } else {
    lines.push("Flagged rows:");
    const budget = MAX_COMPACT_CHARS - lines.join("\n").length - tail.join("\n").length - 120;
    let used = 0;
    let shown = 0;
    for (const line of flagged) {
      if (shown > 0 && used + line.length > budget) break;
      lines.push(line);
      used += line.length + 1;
      shown += 1;
    }
    if (shown < flagged.length) {
      lines.push(`... and ${plural(flagged.length - shown, "more flagged row")} not shown here` +
        (reportId ? `; render_report ${reportId} has the full list.` : "; render_report has the full list."));
    }
  }
  return [...lines, ...tail].join("\n");
}

/** One line: tier word, citation (parties), headline, detail, register link. */
export function formatRowLine(row: Row): string {
  const who = row.parties ? ` (${row.parties}${row.year ? `, ${row.year}` : ""})` : "";
  const times = row.occurrences && row.occurrences > 1 ? ` [cited ${row.occurrences} times]` : "";
  const label = row.tier === "white" && row.support ? `${tierWord(row.tier)} (${supportWord(row.support.status)})` : tierWord(row.tier);
  const parts = [`- ${label}: ${row.citation}${who}${times}.`];
  if (row.tier === "white" && row.support) {
    parts.push(supportText(row));
  } else {
    parts.push(sentence(row.headline));
    if (row.detail) parts.push(sentence(row.detail));
  }
  if (row.evidence?.url) parts.push(`Register: ${row.evidence.url}`);
  return parts.join(" ");
}

/** A full view of one row. */
export function formatRowDetail(row: Row): string {
  const lines = [
    `${tierWord(row.tier)}: ${row.citation}` + (row.parties ? ` (${row.parties}${row.year ? `, ${row.year}` : ""})` : ""),
    sentence(row.headline),
  ];
  if (row.detail) lines.push(sentence(row.detail));
  for (const note of row.notes ?? []) lines.push(`Note: ${sentence(note)}`);
  const e = row.evidence;
  if (e) {
    const facts: string[] = [];
    if (e.register_name) facts.push(`register name: ${e.register_name}`);
    if (e.court) facts.push(`court: ${e.court}`);
    if (e.register_date) facts.push(`date: ${e.register_date}`);
    if (e.citations?.length) facts.push(`citations: ${e.citations.join("; ")}`);
    if (e.cite_points_to) facts.push(`this citation points to: ${e.cite_points_to}`);
    if (facts.length) lines.push(`Evidence: ${facts.join("; ")}.`);
    if (e.url) lines.push(`Register: ${e.url}`);
  }
  return lines.join("\n");
}

function countSupport(white: Row[]): Record<"confirmed" | "likely" | "not_confirmed" | "opposite" | "not_checked", number> {
  const c = { confirmed: 0, likely: 0, not_confirmed: 0, opposite: 0, not_checked: 0 };
  for (const r of white) {
    const status = r.support?.status ?? "not_checked";
    if (status in c) c[status as keyof typeof c] += 1;
    else c.not_checked += 1;
  }
  return c;
}

function supportWord(status: string): string {
  return status.replace(/_/g, " ");
}

function databaseIdsLine(rows: Row[]): string {
  const cites = rows.map((r) => r.citation);
  return `- CANNOT VERIFY: ${plural(rows.length, "Westlaw/Lexis identifier")} (${cites.join("; ")}). ` +
    "Open registers cannot resolve these; check them in Westlaw or Lexis.";
}

function supportText(row: Row): string {
  const sup = row.support!;
  const parts = [sentence(sup.headline ?? `Support: ${supportWord(sup.status)}`)];
  if (sup.confidence !== undefined) parts.push(`(confidence ${sup.confidence.toFixed(2)}${sup.band ? `, ${sup.band}` : ""})`);
  if (sup.passage && sup.status !== "confirmed") parts.push(`Closest passage: "${clip(sup.passage, PASSAGE_CHARS)}"`);
  return parts.join(" ");
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function tierWord(tier: Tier): string {
  return TIER_WORD[tier] ?? String(tier).toUpperCase();
}
