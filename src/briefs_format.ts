import { formatReport, TIER_WORD } from "./format.js";
import type { Brief, BriefChangeItem, BriefChanges, BriefList, BriefListItem, BriefSummary, BriefVersion, BriefVersionInfo, SavedBrief, Tier, UpdatedBrief } from "./types.js";

/** Each list of changed flags gets this much text; the full list of rows that still need attention follows from formatReport. */
const CHANGE_CHARS = 4_000;
/** get_brief lists the newest versions; older ones are counted. */
const MAX_VERSIONS_LISTED = 10;

const TIER_PHRASE: Record<Tier, string> = {
  red: "check this (red)",
  orange: "cannot verify (orange)",
  green: "found (green)",
  white: "deep check (white)",
};

/** `b_1 "Motion to dismiss"`, or `b_1 (untitled)`. */
export function briefLabel(b: { id: string | number; title?: string | null }): string {
  return b.title ? `${b.id} "${b.title}"` : `${b.id} (untitled)`;
}

/** The counts of a check in the tier words: `12 citations: check this (red) 1, cannot verify (orange) 2, found (green) 9`. */
export function summaryCounts(s: BriefSummary | null | undefined, nCitations?: number): string {
  const cites = typeof s?.citations === "number" ? s.citations : nCitations;
  const tiers = (["red", "orange", "green", "white"] as const)
    .filter((t) => typeof s?.[t] === "number" && (t !== "white" || (s[t] as number) > 0))
    .map((t) => `${TIER_PHRASE[t]} ${s![t] as number}`);
  const head = typeof cites === "number" ? plural(cites, "citation") : "";
  if (!tiers.length) return head || "no check recorded";
  return head ? `${head}: ${tiers.join(", ")}` : tiers.join(", ");
}

/** save_brief: the id, then the compact report (coverage, counts, rows that need attention, report id), then the next step. */
export function formatSavedBrief(saved: SavedBrief, reportId?: string): string {
  return [
    `Saved brief ${briefLabel(saved)} to your proofread.law account (stored encrypted; delete_brief removes it permanently).`,
    formatReport(saved.report, reportId),
    `Next: edit the text, then call update_brief with id ${saved.id} and the whole edited text; it saves a new version, re-checks it and says which flags were resolved and which are new.`,
  ].join("\n");
}

/** list_briefs: one line per saved brief. */
export function formatBriefList(list: BriefList): string {
  if (list.briefs.length === 0) {
    return "No saved briefs in this proofread.law account. save_brief saves one (opt-in, stored encrypted in the account).";
  }
  return [
    `${plural(list.briefs.length, "saved brief")} in your proofread.law account (stored encrypted):`,
    ...list.briefs.map(briefListLine),
    "get_brief gives a brief's saved text and latest report; update_brief saves an edited version and re-checks it.",
  ].join("\n");
}

function briefListLine(b: BriefListItem): string {
  const facts: string[] = [];
  if (b.updated_at) facts.push(`saved ${when(b.updated_at)}`);
  if (b.last_checked_at) facts.push(`last checked ${when(b.last_checked_at)}`);
  const n = versionCount(b.versions);
  if (n !== undefined) facts.push(plural(n, "version"));
  return `- ${briefLabel(b)}: ${summaryCounts(b.summary, b.n_citations)}.` + (facts.length ? ` ${capitalise(facts.join(", "))}.` : "");
}

/** get_brief: the brief, its versions, the latest report, and the saved text between two marker lines (never cut: it is what gets edited). */
export function formatBrief(brief: Brief, reportId: string | undefined, includeText: boolean): string {
  const versions = brief.versions ?? [];
  const latest = latestVersion(versions);
  const lines = [`Brief ${briefLabel(brief)}` + (brief.updated_at ? `, saved ${when(brief.updated_at)}` : "") +
    (latest !== undefined ? `, version ${latest} (${plural(versions.length, "version")} kept).` : ".")];
  if (versions.length > 1) lines.push(versionsLine(versions));
  if (brief.report) {
    lines.push("Latest check:", formatReport(brief.report, reportId));
  } else {
    lines.push(`Latest check: ${summaryCounts(brief.summary)}. No report is stored for it.`);
  }
  if (!includeText) {
    lines.push("Text not included (include_text=false); get_brief with include_text=true returns it.");
  } else if (typeof brief.text === "string") {
    lines.push(`Saved text (${latest !== undefined ? `version ${latest}, ` : ""}${brief.text.length.toLocaleString("en-US")} characters). ` +
      "To fix a flagged row, edit this text and send the whole edited text to update_brief:");
    lines.push("--- saved text begins ---", brief.text, "--- saved text ends ---");
  } else {
    lines.push("proofread.law returned no text for this brief.");
  }
  return lines.join("\n");
}

/** get_brief with a version: that version's counts and text. */
export function formatBriefVersion(id: string, version: BriefVersion): string {
  return [
    `Brief ${id}, version ${version.v}` + (version.created_at ? `, saved ${when(version.created_at)}` : "") + `: ${summaryCounts(version.summary)}.`,
    "This is an earlier version as it was saved; get_brief without a version gives the latest text and report. To go back to this text, send it to update_brief.",
    `--- text of version ${version.v} begins ---`,
    version.text,
    `--- text of version ${version.v} ends ---`,
  ].join("\n");
}

/** update_brief: what the re-check changed (resolved flags, new flags, unchanged rows), then the rows that still need attention. */
export function formatUpdatedBrief(updated: UpdatedBrief, reportId: string | undefined, textSent: boolean): string {
  const latest = latestVersion(updated.versions ?? []);
  const saved = `brief ${briefLabel(updated)}` + (latest !== undefined ? ` as version ${latest}` : "");
  if (!updated.changes) {
    const why = textSent
      ? "proofread.law reported no re-check for this save (the text may be the same as the saved version)"
      : "only the title changed, so the text was not re-checked";
    return `Saved ${saved}; ${why}. Latest counts: ${summaryCounts(updated.summary ?? updated.report?.summary)}. get_brief shows the latest report.`;
  }
  const lines = [`Saved ${saved} and re-checked it.`, ...formatChanges(updated.changes)];
  if (updated.report) {
    lines.push("Latest check (every row that still needs attention):", formatReport(updated.report, reportId));
  } else {
    lines.push(`Latest counts: ${summaryCounts(updated.summary)}. get_brief shows the latest report.`);
  }
  lines.push(`Next: fix what is still flagged in the text and call update_brief with id ${updated.id} again, or stop when every remaining row has been reviewed.`);
  return lines.join("\n");
}

/** The counts line, then the resolved flags and the new ones, each list capped at CHANGE_CHARS. */
export function formatChanges(changes: BriefChanges): string[] {
  const lines = [`Changes since the previous version: ${changes.resolved.length} resolved, ${changes.new.length} new, ${plural(changes.unchanged ?? 0, "row")} unchanged.`];
  if (changes.resolved.length) {
    lines.push(`Resolved (${changes.resolved.length}): flagged in the previous version, not flagged now (the citation was changed or taken out):`);
    lines.push(...capped(changes.resolved.map(resolvedLine), "resolved flag"));
  }
  if (changes.new.length) {
    lines.push(`New flags (${changes.new.length}): not flagged in the previous version; the details are in the rows below:`);
    lines.push(...capped(changes.new.map(newLine), "new flag"));
  }
  return lines;
}

function resolvedLine(item: BriefChangeItem): string {
  if (typeof item === "string") return `- ${item}`;
  const tier = tierOf(item);
  return `- ${citeOf(item)}` + (tier ? `: was ${TIER_PHRASE[tier]}` : "");
}

function newLine(item: BriefChangeItem): string {
  if (typeof item === "string") return `- ${item}`;
  const tier = tierOf(item);
  return tier ? `- ${TIER_WORD[tier]}: ${citeOf(item)}` : `- ${citeOf(item)}`;
}

function citeOf(item: Exclude<BriefChangeItem, string>): string {
  const cite = typeof item.citation === "string" ? item.citation : typeof item.cite === "string" ? item.cite : "(citation not given)";
  const who = typeof item.parties === "string" && item.parties ? ` (${item.parties}${typeof item.year === "number" ? `, ${item.year}` : ""})` : "";
  return `${cite}${who}`;
}

function tierOf(item: Exclude<BriefChangeItem, string>): Tier | undefined {
  return typeof item.tier === "string" && item.tier in TIER_PHRASE ? (item.tier as Tier) : undefined;
}

function capped(lines: string[], noun: string): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (out.length > 0 && used + line.length > CHANGE_CHARS) break;
    out.push(line);
    used += line.length + 1;
  }
  if (out.length < lines.length) out.push(`... and ${plural(lines.length - out.length, `more ${noun}`)}.`);
  return out;
}

function versionsLine(versions: BriefVersionInfo[]): string {
  const sorted = [...versions].sort((a, b) => a.v - b.v);
  const shown = sorted.slice(-MAX_VERSIONS_LISTED);
  const older = sorted.length - shown.length;
  const parts = shown.map((x) => `v${x.v}` + (x.created_at ? ` ${when(x.created_at)}` : "") + (x.summary ? ` (${summaryCounts(x.summary)})` : ""));
  return `Versions: ${parts.join("; ")}` + (older > 0 ? `; ${older} older not listed` : "") + ". get_brief with version gives an earlier text.";
}

function latestVersion(versions: BriefVersionInfo[]): number | undefined {
  return versions.length ? Math.max(...versions.map((x) => x.v)) : undefined;
}

function versionCount(versions: BriefListItem["versions"]): number | undefined {
  if (typeof versions === "number") return versions;
  if (Array.isArray(versions)) return versions.length;
  return undefined;
}

/** `2026-09-24T10:00:00Z` reads as `2026-09-24 10:00 UTC`; anything else is shown as sent. */
function when(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|\+00:00)$/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
