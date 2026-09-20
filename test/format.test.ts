import { describe, expect, it } from "vitest";
import { formatReport, formatRowDetail, formatRowLine, MAX_COMPACT_CHARS } from "../src/format.js";
import type { Row } from "../src/types.js";
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

  it("deep mode: found counts green and white rows; confirmed rows are found, not flagged; only not-confirmed and opposite rows are listed", () => {
    const r = sampleReport();
    r.mode = "deep";
    r.summary = { ...r.summary, green: 0, white: 4 };
    const base = r.rows[3]!;
    const white = (n: number, citation: string, support: Row["support"]): Row => ({ ...base, n, citation, parties: `Case ${n}`, tier: "white", support });
    r.rows = [
      r.rows[0]!, // red stays red
      white(10, "1 U.S. 1", { status: "confirmed", headline: "Passage found that states this", confidence: 0.98, band: "high", passage: "the court held" }),
      white(11, "2 U.S. 2", { status: "not_confirmed", headline: "Could not confirm the proposition in the opinion; review", confidence: 0.41, band: "low", passage: "x".repeat(400) }),
      white(12, "3 U.S. 3", { status: "opposite", headline: "The closest passage may state the opposite; review", confidence: 0.7, band: "medium", passage: "we reject" }),
      white(13, "4 U.S. 4", { status: "likely", headline: "A passage may state this (confidence 0.62); review", confidence: 0.62, band: "medium", passage: "maybe" }),
    ];
    const text = formatReport(r, "r_deadbeef");
    const lines = text.split("\n");
    expect(lines[1]).toBe("Summary: 4 citations, 4 rows. Check this (red): 1. Cannot verify (orange): 0. Found (green): 4. Deep-checked (white): 4: 1 confirmed, 1 likely, 1 not confirmed, 1 opposite.");
    expect(lines[2]).toBe("Flagged rows:");
    expect(lines[3]).toMatch(/^- CHECK THIS: 509 U\.S\. 644/);
    expect(lines[4]).toBe('- DEEP CHECK (opposite): 3 U.S. 3 (Case 12, 1954). The closest passage may state the opposite; review. (confidence 0.70, medium) Closest passage: "we reject" Register: https://www.courtlistener.com/opinion/105221/brown-v-board-of-education/');
    expect(lines[5]).toMatch(/^- DEEP CHECK \(not confirmed\): 2 U\.S\. 2 \(Case 11, 1954\)\. Could not confirm the proposition in the opinion; review\. \(confidence 0\.41, low\) Closest passage: "x{299}…"/);
    expect(text).not.toContain("1 U.S. 1"); // confirmed: counted, not listed
    expect(text).not.toContain("4 U.S. 4"); // likely: counted, pointed at render_report
    expect(lines[6]).toBe("Found: 4 rows resolved to a case in the register; 1 of them confirmed by the deep check (a passage states the proposition).");
    expect(lines[7]).toBe("Deep check rows are a review queue, not a verdict: confirm the passage yourself before relying on it. 1 row marked likely (a passage may state this, lower confidence) are listed by render_report.");
    expect(lines[8]).toContain("Report id: r_deadbeef");
  });

  it("deep mode with every row confirmed flags nothing", () => {
    const r = sampleReport();
    r.mode = "deep";
    r.rows = r.rows.filter((x) => x.tier === "green").map((x) => ({ ...x, tier: "white" as const, support: { status: "confirmed" as const, headline: "Passage found that states this", confidence: 0.99 } }));
    r.summary = { ...r.summary, citations: 1, rows: 1, red: 0, orange: 0, green: 0, white: 1, database_ids: 0 };
    const text = formatReport(r);
    expect(text).toContain("Found (green): 1. Deep-checked (white): 1: 1 confirmed, 0 likely, 0 not confirmed, 0 opposite.");
    expect(text).toContain("Flagged rows: none.");
    expect(text).toContain("Found: 1 row resolved to a case in the register; 1 of them confirmed by the deep check");
  });

  it("lists red before orange whatever the document order", () => {
    const r = sampleReport();
    r.rows = [r.rows[1]!, r.rows[3]!, r.rows[0]!]; // orange id, green, red
    r.rows[0]!.reason = undefined; // a plain orange row
    const lines = formatReport(r).split("\n");
    expect(lines[3]).toMatch(/^- CHECK THIS/);
    expect(lines[4]).toMatch(/^- CANNOT VERIFY/);
  });

  it("caps the output and says how many flagged rows were left out", () => {
    const r = sampleReport();
    const orange = r.rows[1]!;
    r.rows = Array.from({ length: 5000 }, (_, i) => ({ ...orange, n: i + 1, citation: `${i + 1} F. Supp. 3d ${i}`, reason: undefined, headline: "F. Supp. 3d volume is newer than our register", detail: "Nothing to check against. Absence here is not evidence. Verify at the source." }));
    r.summary = { ...r.summary, citations: 5000, rows: 5000, red: 0, orange: 5000, green: 0, database_ids: 0 };
    const text = formatReport(r, "r_00000001");
    expect(text.length).toBeLessThan(MAX_COMPACT_CHARS + 200);
    expect(text).toMatch(/\n\.\.\. and \d{4} more flagged rows not shown here; render_report r_00000001 has the full list\.\n/);
    expect(text.split("\n").filter((l) => l.startsWith("- CANNOT VERIFY")).length).toBeGreaterThan(20);
    expect(text).toMatch(/\nStorage: /);
  });

  it("says when no citation was recognised", () => {
    const r = sampleReport();
    r.rows = [];
    r.summary = { ...r.summary, citations: 0, rows: 0, red: 0, orange: 0, green: 0, database_ids: 0 };
    const text = formatReport(r);
    expect(text.split("\n")[1]).toBe("No case citations were recognised in the text. Reporter citations look like '590 U.S. 644' (volume, reporter, page).");
    expect(text).not.toContain("Flagged rows");
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
    expect(explain(e)).toBe("proofread.law: this needs the solo plan (deep). Upgrade at https://proofread.law/pricing. The billing_link tool gives the account owner a checkout link; a paid-plan API key goes in PROOFREAD_API_KEY.");
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
  it("unknown errors are still one sentence; a string is the sentence itself", () => {
    expect(explain(new Error("boom"))).toBe("Unexpected error: boom");
    expect(explain("give an absolute path.")).toBe("give an absolute path.");
  });
  it("a 400 empty from the API reads like the unreadable case", () => {
    expect(explain(new ProofreadError(400, "empty", "no text to check"))).toMatch(/^proofread.law could not read the input: no text to check\./);
  });
  it("signed_out points at the key or sign_up", () => {
    expect(explain(new ProofreadError(401, "signed_out", "send the API key"))).toContain("call sign_up");
  });
});
