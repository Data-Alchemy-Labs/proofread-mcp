import type { Report, Row, Tier } from "./types.js";

/** The words a user sees per tier (PRODUCT.md). Never "fabricated", never "fake". */
export const TIER_WORD: Record<Tier, string> = {
  red: "CHECK THIS",
  orange: "CANNOT VERIFY",
  green: "FOUND",
  white: "DEEP CHECK",
};

const PASSAGE_CHARS = 300;

/**
 * A compact, model-friendly view of a report: the coverage statement first, then the counts,
 * then one line per row that needs a human (red, orange and, in deep mode, white), then the count of found rows.
 * Westlaw/Lexis identifiers are collapsed into one line, as on the site.
 */
export function formatReport(report: Report, reportId?: string): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push(`Coverage: ${report.coverage}`);
  lines.push(
    `Summary: ${s.citations} citation${s.citations === 1 ? "" : "s"}, ${s.rows} row${s.rows === 1 ? "" : "s"}. ` +
      `Check this (red): ${s.red}. Cannot verify (orange): ${s.orange}` +
      (s.database_ids ? `, of which ${s.database_ids} Westlaw/Lexis identifier${s.database_ids === 1 ? "" : "s"}` : "") +
      `. Found (green): ${s.green}.` +
      (report.mode === "deep" ? ` Deep check (white): ${s.white}.` : ""),
  );

  const flagged = report.rows.filter((r) => r.tier !== "green");
  const ids = flagged.filter((r) => r.reason === "database_id");
  const rest = flagged.filter((r) => r.reason !== "database_id");
  if (flagged.length === 0) {
    lines.push("Flagged rows: none.");
  } else {
    lines.push("Flagged rows:");
    for (const row of rest) lines.push(formatRowLine(row));
    if (ids.length) lines.push(databaseIdsLine(ids));
  }
  lines.push(`Found: ${s.green} row${s.green === 1 ? "" : "s"} resolved to a case in the register.`);
  if (report.mode === "deep") {
    lines.push("Deep check rows are a review queue, not a verdict: confirm the passage yourself before relying on it.");
  }
  const tail: string[] = [];
  if (reportId) tail.push(`Report id: ${reportId} (give it to render_report for a markdown report).`);
  if (report.elapsed_s !== undefined) tail.push(`Elapsed: ${report.elapsed_s} s.`);
  if (tail.length) lines.push(tail.join(" "));
  lines.push(`Storage: ${report.storage}`);
  return lines.join("\n");
}

/** One line: tier word, citation (parties), headline, detail, register link. */
export function formatRowLine(row: Row): string {
  const who = row.parties ? ` (${row.parties}${row.year ? `, ${row.year}` : ""})` : "";
  const times = row.occurrences && row.occurrences > 1 ? ` [cited ${row.occurrences} times]` : "";
  const parts = [`- ${tierWord(row.tier)}: ${row.citation}${who}${times}.`];
  if (row.tier === "white" && row.support) {
    parts.push(supportText(row));
  } else {
    parts.push(sentence(row.headline));
    if (row.detail) parts.push(sentence(row.detail));
  }
  if (row.evidence?.url) parts.push(`Register: ${row.evidence.url}`);
  return parts.join(" ");
}

/** A full view of one row, for resolve_citation. */
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

function databaseIdsLine(rows: Row[]): string {
  const cites = rows.map((r) => r.citation);
  const n = rows.length;
  return `- CANNOT VERIFY: ${n} Westlaw/Lexis identifier${n === 1 ? "" : "s"} (${cites.join("; ")}). ` +
    "Open registers cannot resolve these; check them in Westlaw or Lexis.";
}

function supportText(row: Row): string {
  const sup = row.support!;
  const parts = [sentence(sup.headline ?? `Support: ${sup.status}`)];
  if (sup.confidence !== undefined) parts.push(`(confidence ${sup.confidence.toFixed(2)}${sup.band ? `, ${sup.band}` : ""})`);
  if (sup.passage && sup.status !== "confirmed") parts.push(`Closest passage: "${clip(sup.passage, PASSAGE_CHARS)}"`);
  return parts.join(" ");
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
