import { describe, expect, it } from "vitest";
import { formatReport, formatRowDetail, formatRowLine } from "../src/format.js";
import { explain, ProofreadError } from "../src/errors.js";
import { sampleReport } from "./helpers.js";

describe("formatReport", () => {
  const out = formatReport(sampleReport(), "r_0123abcd");
  const lines = out.split("\n");

  it("puts the coverage statement first", () => {
    expect(lines[0]).toMatch(/^Coverage: Checked against 10\.1 M cases/);
  });

  it("then the counts, with the tier words and the Westlaw/Lexis count", () => {
    expect(lines[1]).toBe("Summary: 4 citations, 4 rows. Check this (red): 1. Cannot verify (orange): 2, of which 2 Westlaw/Lexis identifiers. Found (green): 1.");
  });

  it("one line per flagged row: tier word, citation, parties, headline, detail, register link", () => {
    const red = lines.find((l) => l.startsWith("- CHECK THIS"));
    expect(red).toBe(
      "- CHECK THIS: 509 U.S. 644 (Bostock v. Clayton County, 2020) [cited 2 times]. " +
        "Register has Bostock v. Clayton County at 590 U.S. 644. Check the volume. " +
        "In the register, 509 U.S. 644 is Shaw v. Reno. The case named in the document exists; this citation does not point to it. " +
        "Register: https://www.courtlistener.com/opinion/4767953/bostock-v-clayton-county/",
    );
  });

  it("collapses Westlaw/Lexis identifiers into one line", () => {
    const ids = lines.filter((l) => l.startsWith("- CANNOT VERIFY"));
    expect(ids).toHaveLength(1);
    expect(ids[0]).toContain("2 Westlaw/Lexis identifiers (2023 WL 123456; 2022 U.S. Dist. LEXIS 999)");
  });

  it("counts found rows instead of listing them, and carries the report id and storage notice", () => {
    expect(out).not.toContain("Brown v. Board");
    expect(out).toContain("Found: 1 row resolved to a case in the register.");
    expect(out).toContain("Report id: r_0123abcd");
    expect(out).toContain("Elapsed: 0.42 s.");
    expect(lines.at(-1)).toMatch(/^Storage: Nothing you submit is stored/);
  });

  it("never says fabricated or fake", () => {
    expect(out.toLowerCase()).not.toMatch(/fabricat|fake/);
  });

  it("says so when nothing is flagged", () => {
    const r = sampleReport();
    r.rows = r.rows.filter((x) => x.tier === "green");
    r.summary = { ...r.summary, red: 0, orange: 0, database_ids: 0 };
    expect(formatReport(r)).toContain("Flagged rows: none.");
  });

  it("deep mode: white rows show the support headline, confidence, and the passage unless confirmed", () => {
    const r = sampleReport();
    r.mode = "deep";
    r.summary.white = 1;
    r.rows[3] = { ...r.rows[3]!, tier: "white", support: { status: "not_confirmed", headline: "Could not confirm the proposition in the opinion; review", confidence: 0.41, band: "low", passage: "x".repeat(400) } };
    const text = formatReport(r);
    expect(text).toContain("Deep check (white): 1.");
    const white = text.split("\n").find((l) => l.startsWith("- DEEP CHECK"))!;
    expect(white).toContain("347 U.S. 483 (Brown v. Board of Education, 1954). Could not confirm the proposition in the opinion; review. (confidence 0.41, low)");
    expect(white).toMatch(/Closest passage: "x{299}…"/);
    expect(text).toContain("review queue, not a verdict");
  });
});

describe("formatRowLine and formatRowDetail", () => {
  it("adds a full stop only when the headline has none", () => {
    const line = formatRowLine({ n: 1, tier: "orange", citation: "1 F.4th 1", headline: "Could not check this citation?" });
    expect(line).toBe("- CANNOT VERIFY: 1 F.4th 1. Could not check this citation?");
  });

  it("detail view lists the evidence facts", () => {
    const d = formatRowDetail(sampleReport().rows[0]!);
    expect(d.split("\n")[0]).toBe("CHECK THIS: 509 U.S. 644 (Bostock v. Clayton County, 2020)");
    expect(d).toContain("Evidence: register name: Bostock v. Clayton County; court: U.S.; date: 2020-06-15; citations: 590 U.S. 644; 140 S. Ct. 1731; this citation points to: Shaw v. Reno.");
    expect(d).toContain("Register: https://www.courtlistener.com/opinion/4767953/");
  });
});

describe("explain", () => {
  it("402 names the plan and where to upgrade", () => {
    const e = new ProofreadError(402, "plan_required", "deep past allowance", { plan: "solo", feature: "deep", upgrade: "https://proofread.law/pricing" });
    expect(explain(e)).toBe("proofread.law: this needs the solo plan (deep). Upgrade at https://proofread.law/pricing. A Firm API key goes in PROOFREAD_API_KEY.");
  });
  it("429 quota names the numbers", () => {
    const e = new ProofreadError(429, "quota_exceeded", "used", { used: 20, limit: 20, upgrade: "https://proofread.law/pricing" });
    expect(explain(e)).toContain("(20 of 20)");
  });
  it("429 rate limit carries retry_after", () => {
    expect(explain(new ProofreadError(429, "rate_limited", "20 checks per hour", { retry_after: 12 }))).toContain("Retry after 12 s");
  });
  it("network errors pass through", () => {
    expect(explain(ProofreadError.network("https://x", new Error("ECONNREFUSED")))).toBe("Could not reach https://x: ECONNREFUSED");
  });
  it("unknown errors are still one sentence", () => {
    expect(explain(new Error("boom"))).toBe("Unexpected error: boom");
  });
});
