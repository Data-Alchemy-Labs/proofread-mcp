import type { ResolveBatch, ResolveCase, ResolveCoverage, ResolveResult, ResolveStatus } from "./types.js";

/** The words a user sees per register status. A missing entry is a register fact with a coverage qualifier, never a verdict on the author. */
export const STATUS_WORD: Record<ResolveStatus, string> = {
  found: "FOUND",
  ambiguous: "AMBIGUOUS",
  not_found: "NOT IN THE REGISTER",
  unverifiable: "CANNOT VERIFY",
  beyond_register: "CANNOT VERIFY",
  known_cite: "KNOWN CITATION",
  unresolvable: "CANNOT VERIFY",
  unparsed: "NO CITATION RECOGNISED",
};

/** The full answer for one citation: status, the case or the reason, the volume's coverage, then the coverage statement. */
export function formatResolve(r: ResolveResult): string {
  const lines = [headline(r)];
  const c = r.case;
  if (r.status === "found" && c) {
    const others = (c.citations ?? []).filter((x) => x !== r.normalized && x !== caseCiteFor(r));
    if (others.length) lines.push(`Parallel citations: ${others.join("; ")}.`);
    if (c.url) lines.push(`Register: ${c.url}`);
  }
  if (r.status === "ambiguous") {
    for (const cand of r.candidates) lines.push(`- ${caseLine(cand)}${cand.url ? ` ${cand.url}` : ""}`);
  }
  const cov = describeCoverage(r.coverage);
  if (cov) lines.push(cov);
  if (r.coverage_statement) lines.push(`Coverage: ${r.coverage_statement}`);
  return lines.join("\n");
}

/** One line per citation, for the batch tool. */
export function formatResolveLine(r: ResolveResult): string {
  const cite = r.normalized ?? r.cite;
  switch (r.status) {
    case "found":
      return `- FOUND: ${cite} = ${caseLine(r.case!)}${r.match === "pincite" ? ` (pin cite inside ${caseCiteFor(r) ?? "the opinion"})` : ""}${r.case?.url ? ` ${r.case.url}` : ""}`;
    case "ambiguous":
      return `- AMBIGUOUS: ${cite} ${matches(r)}; best: ${r.case ? caseLine(r.case) : "none"}`;
    case "not_found":
      return `- ${label(r)}: ${cite}; ${why(r)}`;
    case "known_cite":
      return `- KNOWN CITATION: ${cite} is not held as an opinion, but other opinions cite it as ${knownAs(r)}`;
    case "unresolvable":
      return `- CANNOT VERIFY: ${cite} is a Westlaw/Lexis identifier; open registers cannot resolve it`;
    case "beyond_register":
    case "unverifiable":
      return `- ${label(r)}: ${cite}; ${why(r)}`;
    case "unparsed":
      return `- NO CITATION RECOGNISED: ${JSON.stringify(r.cite)}`;
    default:
      return `- ${String(r.status).toUpperCase()}: ${cite}`;
  }
}

/** Counts by status, one line per citation, the coverage statement last. */
export function formatResolveBatch(batch: ResolveBatch): string {
  const counts = new Map<string, number>();
  for (const r of batch.results) {
    const word = STATUS_WORD[r.status] ?? String(r.status);
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const n = batch.results.length;
  const summary = [...counts.entries()].map(([w, k]) => `${k} ${w.toLowerCase()}`).join(", ");
  const lines = [`${n} citation${n === 1 ? "" : "s"}: ${summary}.`];
  for (const r of batch.results) lines.push(formatResolveLine(r));
  if (batch.elapsed_s !== undefined) lines.push(`Elapsed: ${batch.elapsed_s} s.`);
  lines.push(`Coverage: ${batch.coverage_statement}`);
  return lines.join("\n");
}

function headline(r: ResolveResult): string {
  const cite = r.normalized ?? r.cite;
  const c = r.case;
  switch (r.status) {
    case "found":
      return r.match === "pincite"
        ? `FOUND: ${cite} is a pin cite inside ${caseLine(c!)}, reported at ${caseCiteFor(r) ?? "this reporter"}.`
        : `FOUND: ${cite} is ${caseLine(c!)}.`;
    case "ambiguous":
      return `AMBIGUOUS: ${cite} ${matches(r)}; the best match is ${c ? caseLine(c) : "unclear"}. Candidates:`;
    case "not_found":
      return `${label(r)}: ${cite}. ${why(r)}`;
    case "known_cite":
      return `KNOWN CITATION: ${cite} is not held as an opinion, but other opinions cite it as ${knownAs(r)}. The register cannot show the opinion itself; check it in another source.`;
    case "unresolvable":
      return `CANNOT VERIFY: ${cite} is a Westlaw/Lexis identifier. Open registers cannot resolve it; check it in Westlaw or Lexis.`;
    case "beyond_register":
    case "unverifiable":
      return `${label(r)}: ${cite}. ${why(r)}`;
    case "unparsed":
      return `NO CITATION RECOGNISED in ${JSON.stringify(r.cite)}. Reporter citations look like '590 U.S. 644' (volume, reporter, page).`;
    default:
      return `${String(r.status).toUpperCase()}: ${cite}.`;
  }
}

function matches(r: ResolveResult): string {
  const n = r.candidates.length;
  return n > 1 ? `matches ${n} entries in the register` : "matches more than one entry in the register";
}

function caseLine(c: ResolveCase): string {
  const when = [c.court, c.date].filter(Boolean).join(", ");
  return when ? `${c.name} (${when})` : c.name;
}

/** The case's own citation in the reporter that was asked for (for a pin cite, the opinion's first page). */
function caseCiteFor(r: ResolveResult): string | undefined {
  const reporter = r.coverage?.reporter;
  if (!reporter || !r.case?.citations) return undefined;
  return r.case.citations.find((x) => x.includes(` ${reporter} `));
}

function knownAs(r: ResolveResult): string {
  const k = r.known_as;
  if (!k) return "another case";
  const bits = [k.court_hint, k.year !== undefined ? String(k.year) : undefined].filter(Boolean).join(", ");
  const cited = k.n_citing !== undefined ? `, cited by ${k.n_citing} opinion${k.n_citing === 1 ? "" : "s"}` : "";
  return `${k.name}${bits ? ` (${bits})` : ""}${cited}`;
}

function volumeHeld(cov: ResolveCoverage | null): string | undefined {
  if (!cov?.reporter || !cov.volume) return undefined;
  const n = cov.volume_n !== undefined ? ` (${cov.volume_n} case${cov.volume_n === 1 ? "" : "s"})` : "";
  if (cov.register_coverage === "volume_thin") return `${cov.reporter} volume ${cov.volume} is only partly held${n}`;
  if (cov.register_coverage === "volume_absent") return `no part of ${cov.reporter} volume ${cov.volume} is held`;
  return `${cov.reporter} volume ${cov.volume} is held${n}`;
}

/** The API's reason for an unverifiable / beyond_register / not_found answer, as a short label after the status word. */
const REASON_LABEL: Record<string, string> = {
  recent: "recent, unverified",
  volume_thin: "held only in part",
  volume_newer_than_register: "newer than the register",
  reporter_absent: "reporter not held",
  page_absent: "not in the register",
};

function label(r: ResolveResult): string {
  const word = STATUS_WORD[r.status] ?? String(r.status).toUpperCase();
  const extra = r.reason ? REASON_LABEL[r.reason] ?? r.reason.replace(/_/g, " ") : undefined;
  return extra && extra.toUpperCase() !== word ? `${word} (${extra})` : word;
}

const NOT_A_VERDICT = "This is a register fact with a coverage qualifier, not proof that the case does not exist; check the citation in another source.";

/** The API's `note` verbatim when it sends one; else a sentence from `reason`; else (older API) from the coverage block alone. */
function why(r: ResolveResult): string {
  if (r.note) return sentence(r.note);
  const cov = r.coverage;
  const vol = cov?.reporter && cov.volume ? `${cov.reporter} volume ${cov.volume}` : "this volume";
  const n = cov?.volume_n !== undefined ? ` (${cov.volume_n} case${cov.volume_n === 1 ? "" : "s"})` : "";
  switch (r.reason) {
    case "recent":
      return "The citation is recent; the register may hold the case without this citation attached. Resolve with the case name and court, or check at the source.";
    case "volume_thin":
      return `${vol} is held only in part${n}, so a missing page is a weak claim. ${NOT_A_VERDICT}`;
    case "volume_newer_than_register":
      return `${vol} is newer than the register${cov?.max_volume !== undefined ? `, which runs to volume ${cov.max_volume}` : ""}. ${NOT_A_VERDICT}`;
    case "reporter_absent":
      return `The register does not hold ${cov?.reporter ? `the ${cov.reporter} reporter` : "this reporter"}. ${NOT_A_VERDICT}`;
    case "page_absent":
      return `${vol} is held${n} but has no case at this page. ${NOT_A_VERDICT}`;
    default:
      return `${legacyWhy(r)} ${NOT_A_VERDICT}`;
  }
}

/** Older API answers (no reason, no note): say only what the coverage block supports. */
function legacyWhy(r: ResolveResult): string {
  const cov = r.coverage;
  if (!cov?.reporter) return "The register cannot see this citation: the reporter is not held.";
  const vol = `${cov.reporter} volume ${cov.volume ?? "?"}`;
  if (cov.beyond_max && cov.max_volume !== undefined) return `${vol} is newer than the register, which runs to volume ${cov.max_volume}.`;
  if (cov.register_coverage === "volume_absent") return `No part of ${vol} is held.`;
  if (r.status === "not_found") return `${vol} is held but has no case at this page.`;
  return `${vol} is held, but this citation could not be attached to a case.`;
}

/** The coverage of the volume that was asked for, so a not_found inside a thin volume reads as the weak claim it is. */
function describeCoverage(cov: ResolveCoverage | null): string | undefined {
  if (!cov?.reporter || !cov.volume || cov.register_coverage === "database_id") return undefined;
  const held = volumeHeld(cov);
  const runs = cov.max_volume !== undefined ? `; the register runs to ${cov.reporter} volume ${cov.max_volume}` : "";
  return held ? `Register coverage: ${held}${runs}.` : undefined;
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
