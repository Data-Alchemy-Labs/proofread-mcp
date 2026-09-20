import { describe, expect, it } from "vitest";
import { formatResolve, formatResolveBatch, formatResolveLine } from "../src/resolve_format.js";
import type { ResolveResult } from "../src/types.js";
import { resolveBatch, resolveResult } from "./helpers.js";

const COVERAGE = /\nCoverage: Checked against 10\.1 M cases/;

describe("formatResolve (one citation)", () => {
  it("found: the case, court, date, parallel citations, link, the volume's coverage, then the coverage statement", () => {
    const out = formatResolve(resolveResult("found"));
    const lines = out.split("\n");
    expect(lines[0]).toBe("FOUND: 590 U.S. 644 is Bostock v. Clayton County (scotus, 2020-06-15).");
    expect(lines[1]).toMatch(/^Parallel citations: 140 S\. Ct\. 1731; 207 L\. Ed\. 2d 218; /);
    expect(lines[1]).not.toContain("590 U.S. 644;");
    expect(lines[2]).toBe("Register: https://www.courtlistener.com/opinion/4760997/bostock-v-clayton-county/");
    expect(lines[3]).toBe("Register coverage: U.S. volume 590 is only partly held (24 cases); the register runs to U.S. volume 606.");
    expect(lines.at(-1)).toMatch(/^Coverage: Checked against/);
  });

  it("found as a pin cite names the opinion's own first page", () => {
    const pin = resolveBatch().results[1]!;
    const out = formatResolve({ ...pin, coverage_statement: "C" });
    expect(out.split("\n")[0]).toBe("FOUND: 509 U.S. 644 is a pin cite inside Shaw v. Reno (scotus, 1993-06-28), reported at 509 U.S. 630.");
    expect(out).toContain("Parallel citations: 113 S. Ct. 2816;");
  });

  it("ambiguous lists the candidates", () => {
    const moore = resolveBatch().results[2]!;
    const r: ResolveResult = { ...moore, status: "ambiguous", candidates: [moore.case!, { ...moore.case!, id: 1 }], coverage_statement: "C" };
    const out = formatResolve(r);
    expect(out).toMatch(/^AMBIGUOUS: 600 U\.S\. 1 matches 2 entries in the register; the best match is Moore v\. Harper \(scotus, 2023-06-27\)\. Candidates:\n- Moore v\. Harper \(scotus, 2023-06-27\) https:/);
    expect(out.split("\n").filter((l) => l.startsWith("- Moore"))).toHaveLength(2);
    expect(out).toMatch(/\nCoverage: C$/);
  });

  it("not_found (page_absent) is a register fact with the volume's coverage, never a verdict on the author", () => {
    const out = formatResolve(resolveResult("not_found"));
    expect(out.split("\n")[0]).toBe(
      "NOT IN THE REGISTER: 100 F.3d 99999. F.3d volume 100 is held (238 cases) but has no case at this page. This is a register fact with a coverage qualifier, not proof that the case does not exist; check the citation in another source.",
    );
    expect(out).toContain("Register coverage: F.3d volume 100 is held (238 cases); the register runs to F.3d volume 999.");
    expect(out.toLowerCase()).not.toMatch(/fabricat|fake|invented|does not exist\b(?!;)/);
  });

  it("beyond_register (volume_newer_than_register) names the reason", () => {
    const out = formatResolve(resolveResult("beyond_register"));
    expect(out.split("\n")[0]).toBe(
      "CANNOT VERIFY (newer than the register): 999 U.S. 1. U.S. volume 999 is newer than the register, which runs to volume 606. This is a register fact with a coverage qualifier, not proof that the case does not exist; check the citation in another source.",
    );
  });

  it("unverifiable (recent) uses the API's note verbatim and never says the volume is not held", () => {
    const out = formatResolve(resolveResult("unverifiable"));
    expect(out.split("\n")[0]).toBe(
      "CANNOT VERIFY (recent, unverified): 925 F.3d 1339. 2019 is within 7 years of the register's dump; the register may hold the case without this citation attached. Resolve with the case name and court, or check at the source.",
    );
    expect(out).toContain("Register coverage: F.3d volume 925 is held (116 cases)");
    expect(out).not.toContain("no part of");
  });

  it("reason without a note gets a sentence per reason", () => {
    const base: ResolveResult = { cite: "x", normalized: "x", status: "unverifiable", case: null, candidates: [], coverage: { register_coverage: "volume_thin", reporter: "F. Supp. 3d", volume: "700", volume_n: 12, max_volume: 830 }, coverage_statement: "C" };
    expect(formatResolve({ ...base, reason: "volume_thin" }).split("\n")[0]).toBe(
      "CANNOT VERIFY (held only in part): x. F. Supp. 3d volume 700 is held only in part (12 cases), so a missing page is a weak claim. This is a register fact with a coverage qualifier, not proof that the case does not exist; check the citation in another source.");
    expect(formatResolve({ ...base, reason: "reporter_absent", coverage: { register_coverage: "reporter_unknown", reporter: "Foo." } }).split("\n")[0]).toBe(
      "CANNOT VERIFY (reporter not held): x. The register does not hold the Foo. reporter. This is a register fact with a coverage qualifier, not proof that the case does not exist; check the citation in another source.");
    expect(formatResolve({ ...base, reason: "recent" }).split("\n")[0]).toBe(
      "CANNOT VERIFY (recent, unverified): x. The citation is recent; the register may hold the case without this citation attached. Resolve with the case name and court, or check at the source.");
    expect(formatResolve({ ...base, status: "not_found", reason: "page_absent", coverage: { register_coverage: "volume_present", reporter: "F.3d", volume: "100", volume_n: 238 } }).split("\n")[0]).toBe(
      "NOT IN THE REGISTER: x. F.3d volume 100 is held (238 cases) but has no case at this page. This is a register fact with a coverage qualifier, not proof that the case does not exist; check the citation in another source.");
  });

  it("older API (no reason, no note): says only what the coverage block supports", () => {
    const legacy = (status: ResolveResult["status"], coverage: ResolveResult["coverage"]): string =>
      formatResolve({ cite: "x", normalized: "x", status, case: null, candidates: [], coverage, coverage_statement: "C" }).split("\n")[0]!;
    expect(legacy("unverifiable", { register_coverage: "volume_present", reporter: "F.3d", volume: "925", volume_n: 116, max_volume: 999 })).toBe(
      "CANNOT VERIFY: x. F.3d volume 925 is held, but this citation could not be attached to a case. This is a register fact with a coverage qualifier, not proof that the case does not exist; check the citation in another source.");
    expect(legacy("unverifiable", { register_coverage: "volume_absent", reporter: "U.S.", volume: "700" })).toMatch(/^CANNOT VERIFY: x\. No part of U\.S\. volume 700 is held\./);
    expect(legacy("beyond_register", { register_coverage: "volume_absent", reporter: "U.S.", volume: "999", beyond_max: true, max_volume: 606 })).toMatch(/^CANNOT VERIFY: x\. U\.S\. volume 999 is newer than the register, which runs to volume 606\./);
    expect(legacy("unverifiable", { register_coverage: "reporter_unknown" })).toMatch(/^CANNOT VERIFY: x\. The register cannot see this citation: the reporter is not held\./);
    expect(legacy("not_found", { register_coverage: "volume_present", reporter: "F.3d", volume: "100" })).toMatch(/^NOT IN THE REGISTER: x\. F\.3d volume 100 is held but has no case at this page\./);
  });

  it("known_cite says other opinions cite it as the name", () => {
    const r: ResolveResult = { cite: "1 F.4th 12", normalized: "1 F.4th 12", status: "known_cite", case: null, candidates: [], coverage: null,
      known_as: { name: "Smith v. Jones", year: 2021, court_hint: "9th Cir.", n_citing: 12 }, coverage_statement: "C" };
    expect(formatResolve(r)).toBe(
      "KNOWN CITATION: 1 F.4th 12 is not held as an opinion, but other opinions cite it as Smith v. Jones (9th Cir., 2021), cited by 12 opinions. The register cannot show the opinion itself; check it in another source.\nCoverage: C",
    );
  });

  it("unresolvable uses the Westlaw/Lexis wording", () => {
    expect(formatResolve(resolveResult("unresolvable")).split("\n")[0]).toBe(
      "CANNOT VERIFY: 2023 WL 4567890 is a Westlaw/Lexis identifier. Open registers cannot resolve it; check it in Westlaw or Lexis.",
    );
  });

  it("unparsed says no citation was recognised", () => {
    const out = formatResolve(resolveResult("unparsed"));
    expect(out.split("\n")[0]).toBe("NO CITATION RECOGNISED in \"no citation here\". Reporter citations look like '590 U.S. 644' (volume, reporter, page).");
    expect(out).toMatch(COVERAGE);
  });
});

describe("formatResolveBatch", () => {
  const out = formatResolveBatch(resolveBatch());
  const lines = out.split("\n");

  it("counts by status first", () => {
    expect(lines[0]).toBe("8 citations: 3 found, 1 not in the register, 3 cannot verify, 1 no citation recognised.");
  });

  it("one line per citation in input order, the coverage statement last", () => {
    expect(lines[1]).toBe("- FOUND: 590 U.S. 644 = Bostock v. Clayton County (scotus, 2020-06-15) https://www.courtlistener.com/opinion/4760997/bostock-v-clayton-county/");
    expect(lines[2]).toBe("- FOUND: 509 U.S. 644 = Shaw v. Reno (scotus, 1993-06-28) (pin cite inside 509 U.S. 630) https://www.courtlistener.com/opinion/112905/shaw-v-reno/");
    expect(lines[3]).toMatch(/^- FOUND: 600 U\.S\. 1 = Moore v\. Harper \(scotus, 2023-06-27\) https:/);
    expect(lines[4]).toBe("- NOT IN THE REGISTER: 100 F.3d 99999; F.3d volume 100 is held (238 cases) but has no case at this page. This is a register fact with a coverage qualifier, not proof that the case does not exist; check the citation in another source.");
    expect(lines[5]).toBe("- CANNOT VERIFY (newer than the register): 999 U.S. 1; U.S. volume 999 is newer than the register, which runs to volume 606. This is a register fact with a coverage qualifier, not proof that the case does not exist; check the citation in another source.");
    expect(lines[6]).toBe("- CANNOT VERIFY: 2023 WL 4567890 is a Westlaw/Lexis identifier; open registers cannot resolve it");
    expect(lines[7]).toBe('- NO CITATION RECOGNISED: "no citation here"');
    expect(lines[8]).toBe("- CANNOT VERIFY (recent, unverified): 925 F.3d 1339; 2019 is within 7 years of the register's dump; the register may hold the case without this citation attached. Resolve with the case name and court, or check at the source.");
    expect(lines[9]).toMatch(/^Elapsed: /);
    expect(lines[10]).toMatch(/^Coverage: Checked against/);
    expect(lines).toHaveLength(11);
  });

  it("known_cite line", () => {
    const r: ResolveResult = { cite: "1 F.4th 12", normalized: "1 F.4th 12", status: "known_cite", case: null, candidates: [], coverage: null, known_as: { name: "Smith v. Jones" } };
    expect(formatResolveLine(r)).toBe("- KNOWN CITATION: 1 F.4th 12 is not held as an opinion, but other opinions cite it as Smith v. Jones");
  });
});
