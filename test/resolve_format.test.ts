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
    expect(lines[3]).toBe("Register coverage: U.S. volume 590 is only partly held (45 cases); the register runs to U.S. volume 606.");
    expect(lines.at(-1)).toMatch(/^Coverage: Checked against/);
  });

  it("found as a pin cite names the opinion's own first page", () => {
    const pin = resolveBatch().results[1]!;
    const out = formatResolve({ ...pin, coverage_statement: "C" });
    expect(out.split("\n")[0]).toBe("FOUND: 509 U.S. 644 is a pin cite inside Shaw v. Reno (scotus, 1993-06-28), reported at 509 U.S. 630.");
    expect(out).toContain("Parallel citations: 113 S. Ct. 2816;");
  });

  it("ambiguous lists the candidates", () => {
    const out = formatResolve(resolveResult("ambiguous"));
    expect(out).toMatch(/^AMBIGUOUS: 600 U\.S\. 1 matches more than one entry in the register; the best match is Moore v\. Harper \(scotus, 2023-06-27\)\. Candidates:\n- Moore v\. Harper \(scotus, 2023-06-27\) https:/);
    expect(out).toMatch(COVERAGE);
  });

  it("not_found is a register fact with the volume's coverage, never a verdict on the author", () => {
    const out = formatResolve(resolveResult("not_found"));
    expect(out.split("\n")[0]).toBe(
      "NOT IN THE REGISTER: 1 F.4th 99999. The register has no case at this page. A missing entry is a register fact with a coverage qualifier (below), not proof that the case does not exist; check the citation in another source.",
    );
    expect(out).toContain("Register coverage: F.4th volume 1 is held (117 cases); the register runs to F.4th volume 145.");
    expect(out.toLowerCase()).not.toMatch(/fabricat|fake|invented|does not exist\b(?!;)/);
  });

  it("beyond_register says the register cannot see this yet", () => {
    const out = formatResolve(resolveResult("beyond_register"));
    expect(out.split("\n")[0]).toBe(
      "CANNOT VERIFY: 999 U.S. 1. The register cannot see this yet: U.S. volume 999 is newer than the register, which runs to volume 606. This says nothing about whether the case exists; check it in another source.",
    );
  });

  it("unverifiable (reporter not held) uses the same wording", () => {
    const r: ResolveResult = { cite: "1 Foo. 2", normalized: "1 Foo. 2", status: "unverifiable", case: null, candidates: [], coverage: { register_coverage: "reporter_unknown" }, coverage_statement: "C" };
    expect(formatResolve(r)).toBe("CANNOT VERIFY: 1 Foo. 2. The register cannot see this yet: this reporter is not in the register. This says nothing about whether the case exists; check it in another source.\nCoverage: C");
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
    expect(lines[0]).toBe("7 citations: 2 found, 1 ambiguous, 1 not in the register, 2 cannot verify, 1 no citation recognised.");
  });

  it("one line per citation in input order, the coverage statement last", () => {
    expect(lines[1]).toBe("- FOUND: 590 U.S. 644 = Bostock v. Clayton County (scotus, 2020-06-15) https://www.courtlistener.com/opinion/4760997/bostock-v-clayton-county/");
    expect(lines[2]).toBe("- FOUND: 509 U.S. 644 = Shaw v. Reno (scotus, 1993-06-28) (pin cite inside 509 U.S. 630) https://www.courtlistener.com/opinion/112905/shaw-v-reno/");
    expect(lines[3]).toBe("- AMBIGUOUS: 600 U.S. 1 matches more than one entry in the register; best: Moore v. Harper (scotus, 2023-06-27)");
    expect(lines[4]).toBe("- NOT IN THE REGISTER: 1 F.4th 99999; F.4th volume 1 is held (117 cases) but nothing at this page (a register fact, not evidence about the citation)");
    expect(lines[5]).toBe("- CANNOT VERIFY: 999 U.S. 1; the register cannot see this yet (U.S. volume 999 is newer than the register, which runs to volume 606)");
    expect(lines[6]).toBe("- CANNOT VERIFY: 2023 WL 4567890 is a Westlaw/Lexis identifier; open registers cannot resolve it");
    expect(lines[7]).toBe('- NO CITATION RECOGNISED: "no citation here"');
    expect(lines[8]).toMatch(/^Elapsed: /);
    expect(lines[9]).toMatch(/^Coverage: Checked against/);
    expect(lines).toHaveLength(10);
  });

  it("known_cite line", () => {
    const r: ResolveResult = { cite: "1 F.4th 12", normalized: "1 F.4th 12", status: "known_cite", case: null, candidates: [], coverage: null, known_as: { name: "Smith v. Jones" } };
    expect(formatResolveLine(r)).toBe("- KNOWN CITATION: 1 F.4th 12 is not held as an opinion, but other opinions cite it as Smith v. Jones");
  });
});
