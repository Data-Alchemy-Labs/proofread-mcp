import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "../src/server.js";
import { connectedClient, error402, error429, resolveBatch, resolveResult, sampleReport, sseBody, textOf } from "./helpers.js";

type Connected = Awaited<ReturnType<typeof connectedClient>>;
let session: Connected | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

const network = { throws: new TypeError("fetch failed") };

describe("tools/list", () => {
  it("lists the five tools with descriptions written for a model", async () => {
    session = await connectedClient();
    const { tools } = await session.mcp.listTools();
    expect(tools.map((t) => t.name)).toEqual(["check_citations", "check_document", "resolve_citation", "resolve_citations", "coverage", "render_report"]);
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(80);
      expect(t.annotations?.readOnlyHint).toBe(true);
    }
    const check = tools.find((t) => t.name === "check_citations")!;
    expect(check.description).toContain("Westlaw");
    expect(check.description).toContain("statutes");
    for (const t of tools) expect(t.description?.toLowerCase()).not.toMatch(/fabricat|fake/);
  });

  it("the server instructions follow the wording rule too", () => {
    expect(INSTRUCTIONS.toLowerCase()).not.toMatch(/fabricat|fake/);
    expect(INSTRUCTIONS).toContain("coverage statement");
  });
});

describe("check_citations", () => {
  it("returns the compact result with a report id and a structured summary", async () => {
    session = await connectedClient({ body: sampleReport() });
    const result = await session.mcp.callTool({ name: "check_citations", arguments: { text: "Bostock, 509 U.S. 644" } });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toMatch(/^Coverage: /);
    expect(text).toContain("- CHECK THIS: 509 U.S. 644");
    expect(text).toMatch(/Report id: r_[0-9a-f]{8}/);
    expect((result.structuredContent as { summary: { red: number } }).summary.red).toBe(1);
    expect(session.calls[0]?.url).toBe("https://api.test/verify");
  });

  it("deep=true asks for one JSON when the client sent no progress token", async () => {
    session = await connectedClient({ body: { ...sampleReport(), mode: "deep" } });
    await session.mcp.callTool({ name: "check_citations", arguments: { text: "x", deep: true } });
    expect(session.calls[0]?.url).toBe("https://api.test/verify?deep=1&stream=0");
  });

  it("deep=true streams and sends a progress notification per row when the client asked for progress", async () => {
    const provisional = { ...sampleReport(), mode: "deep" as const };
    provisional.summary.deep_pending = 1;
    const row = { ...provisional.rows[3]!, tier: "white" as const, support: { status: "confirmed" as const, headline: "Passage found that states this", confidence: 0.9 } };
    session = await connectedClient({ text: sseBody(provisional, [row], { summary: { white: 1, green: 0 } }), headers: { "content-type": "text/event-stream" } });
    const progress: Array<{ progress: number; total?: number; message?: string }> = [];
    const result = await session.mcp.callTool({ name: "check_citations", arguments: { text: "x", deep: true } }, undefined, {
      onprogress: (p) => progress.push(p),
    });
    expect(session.calls[0]?.url).toBe("https://api.test/verify?deep=1");
    expect(progress).toEqual([{ progress: 1, total: 1, message: "347 U.S. 483: Passage found that states this" }]);
    expect(textOf(result)).toContain("- DEEP CHECK: 347 U.S. 483");
  });

  it("402 becomes a readable plan message, not a protocol error", async () => {
    session = await connectedClient({ status: 402, body: error402 });
    const result = await session.mcp.callTool({ name: "check_citations", arguments: { text: "x", deep: true } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("proofread.law: this needs the solo plan (deep). Upgrade at https://proofread.law/pricing. A Firm API key goes in PROOFREAD_API_KEY.");
  });

  it("429 carries the retry hint", async () => {
    session = await connectedClient({ status: 429, body: error429 });
    const result = await session.mcp.callTool({ name: "check_citations", arguments: { text: "x" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("proofread.law rate limit: 20 checks per hour; try again in 3565 s. Retry after 3565 s.");
  });

  it("network failure names the host", async () => {
    session = await connectedClient(network);
    const result = await session.mcp.callTool({ name: "check_citations", arguments: { text: "x" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Could not reach https://api.test: fetch failed");
  });

  it("rejects empty text at the schema", async () => {
    session = await connectedClient();
    const result = await session.mcp.callTool({ name: "check_citations", arguments: { text: "" } });
    expect(result.isError).toBe(true);
    expect(session.calls).toHaveLength(0);
  });
});

describe("check_document", () => {
  async function tempFile(name: string, content = "See Brown v. Board of Education, 347 U.S. 483 (1954).") {
    const dir = await mkdtemp(join(tmpdir(), "proofread-mcp-"));
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  }

  it("uploads the file as multipart and returns the compact result", async () => {
    session = await connectedClient({ body: sampleReport() });
    const path = await tempFile("brief.txt");
    const result = await session.mcp.callTool({ name: "check_document", arguments: { path } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/^Coverage: /);
    const form = session.calls[0]!.init.body as FormData;
    expect((form.get("file") as File).name).toBe("brief.txt");
  });

  it("refuses other extensions without calling the API", async () => {
    session = await connectedClient({ body: sampleReport() });
    const path = await tempFile("brief.rtf");
    const result = await session.mcp.callTool({ name: "check_document", arguments: { path } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("only .pdf, .docx, .txt and .md");
    expect(session.calls).toHaveLength(0);
  });

  it("reports a missing file plainly", async () => {
    session = await connectedClient();
    const result = await session.mcp.callTool({ name: "check_document", arguments: { path: "/nonexistent/brief.pdf" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("could not read /nonexistent/brief.pdf");
  });

  it("402 for .docx on the free tier reads as a plan message", async () => {
    session = await connectedClient({ status: 402, body: { error: { code: "plan_required", message: "docx", plan: "solo", feature: "docx" } } });
    const path = await tempFile("brief.docx", "not really a docx");
    const result = await session.mcp.callTool({ name: "check_document", arguments: { path } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("needs the solo plan (docx)");
  });

  it("429 and network errors surface", async () => {
    session = await connectedClient({ status: 429, body: error429 }, network);
    const path = await tempFile("a.txt");
    expect(textOf(await session.mcp.callTool({ name: "check_document", arguments: { path } }))).toContain("rate limit");
    expect(textOf(await session.mcp.callTool({ name: "check_document", arguments: { path } }))).toContain("Could not reach");
  });
});

describe("resolve_citation", () => {
  it("GETs /v1/resolve (not /verify) and returns the case with the coverage statement", async () => {
    session = await connectedClient({ body: resolveResult("found") });
    const result = await session.mcp.callTool({ name: "resolve_citation", arguments: { citation: "Bostock v. Clayton County, 590 U.S. 644 (2020)" } });
    const text = textOf(result);
    expect(text.split("\n")[0]).toBe("FOUND: 590 U.S. 644 is Bostock v. Clayton County (scotus, 2020-06-15).");
    expect(text).toMatch(/\nCoverage: Checked against/);
    expect(session.calls[0]?.url).toBe("https://api.test/v1/resolve?cite=Bostock%20v.%20Clayton%20County%2C%20590%20U.S.%20644%20(2020)");
    expect(session.calls[0]?.init.method).toBe("GET");
    expect(result.structuredContent).toMatchObject({ status: "found", cite: "590 U.S. 644", case: { id: 4760997, name: "Bostock v. Clayton County" } });
  });

  it("says when no citation was recognised", async () => {
    session = await connectedClient({ body: resolveResult("unparsed") });
    const text = textOf(await session.mcp.callTool({ name: "resolve_citation", arguments: { citation: "no citation here" } }));
    expect(text).toContain('NO CITATION RECOGNISED in "no citation here"');
    expect(text).toContain("Coverage:");
  });

  it("400, 402, 429 and network errors surface", async () => {
    session = await connectedClient({ status: 400, body: { error: { code: "missing_cite", message: "send ?cite=590+U.S.+644" } } },
      { status: 402, body: error402 }, { status: 429, body: error429 }, network);
    const call = () => session!.mcp.callTool({ name: "resolve_citation", arguments: { citation: "1 U.S. 1" } });
    expect(textOf(await call())).toBe("proofread.law: send ?cite=590+U.S.+644.");
    expect(textOf(await call())).toContain("needs the solo plan");
    expect(textOf(await call())).toContain("rate limit");
    expect(textOf(await call())).toContain("Could not reach");
  });
});

describe("resolve_citations (batch)", () => {
  it("POSTs the list to /v1/resolve and returns one line per citation with counts and the coverage statement", async () => {
    session = await connectedClient({ body: resolveBatch() });
    const cites = ["590 U.S. 644", "509 U.S. 644", "600 U.S. 1", "1 F.4th 99999", "999 U.S. 1", "2023 WL 4567890", "no citation here"];
    const result = await session.mcp.callTool({ name: "resolve_citations", arguments: { cites } });
    const text = textOf(result);
    expect(text.split("\n")[0]).toBe("7 citations: 2 found, 1 ambiguous, 1 not in the register, 2 cannot verify, 1 no citation recognised.");
    expect(text).toContain("- FOUND: 590 U.S. 644 = Bostock v. Clayton County");
    expect(text).toContain("- CANNOT VERIFY: 2023 WL 4567890 is a Westlaw/Lexis identifier");
    expect(text.split("\n").at(-1)).toMatch(/^Coverage: Checked against/);
    expect(session.calls[0]?.url).toBe("https://api.test/v1/resolve");
    expect(JSON.parse(String(session.calls[0]!.init.body))).toEqual({ cites });
    expect((result.structuredContent as { results: unknown[] }).results).toHaveLength(7);
  });

  it("rejects an empty list and more than 500 at the schema, without calling", async () => {
    session = await connectedClient({ body: resolveBatch() });
    expect((await session.mcp.callTool({ name: "resolve_citations", arguments: { cites: [] } })).isError).toBe(true);
    expect((await session.mcp.callTool({ name: "resolve_citations", arguments: { cites: new Array(501).fill("1 U.S. 1") } })).isError).toBe(true);
    expect(session.calls).toHaveLength(0);
  });

  it("402, 429 (quota) and network errors surface", async () => {
    session = await connectedClient({ status: 402, body: error402 },
      { status: 429, body: { error: { code: "quota_exceeded", message: "resolves used", used: 1000, limit: 1000, upgrade: "https://proofread.law/pricing" } } }, network);
    const call = () => session!.mcp.callTool({ name: "resolve_citations", arguments: { cites: ["1 U.S. 1"] } });
    expect(textOf(await call())).toContain("needs the solo plan");
    expect(textOf(await call())).toContain("monthly allowance used (1000 of 1000)");
    expect(textOf(await call())).toContain("Could not reach");
  });
});

describe("coverage", () => {
  it("returns the statement and the storage notice", async () => {
    session = await connectedClient({ body: { coverage: "Checked against N cases", storage: "Nothing you submit is stored." } });
    const result = await session.mcp.callTool({ name: "coverage", arguments: {} });
    expect(textOf(result)).toBe("Coverage: Checked against N cases\nStorage: Nothing you submit is stored.");
    expect(result.structuredContent).toEqual({ coverage: "Checked against N cases", storage: "Nothing you submit is stored." });
  });

  it("402, 429 and network errors surface", async () => {
    session = await connectedClient({ status: 402, body: error402 }, { status: 429, body: error429 }, network);
    const call = () => session!.mcp.callTool({ name: "coverage", arguments: {} });
    const first = await call();
    expect(first.isError).toBe(true);
    expect(textOf(first)).toContain("needs the solo plan");
    expect(textOf(await call())).toContain("rate limit");
    expect(textOf(await call())).toContain("Could not reach");
  });
});

describe("render_report", () => {
  it("renders by report id from a previous check", async () => {
    session = await connectedClient({ body: sampleReport() }, { text: "# report\n\n| tier |" });
    const check = await session.mcp.callTool({ name: "check_citations", arguments: { text: "x" } });
    const id = /Report id: (r_[0-9a-f]{8})/.exec(textOf(check))![1]!;
    const result = await session.mcp.callTool({ name: "render_report", arguments: { report_id: id } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe("# report\n\n| tier |");
    expect(session.calls[1]?.url).toBe("https://api.test/render?format=md");
    expect(JSON.parse(String(session.calls[1]!.init.body)).rows).toHaveLength(4);
  });

  it("renders from a full report JSON", async () => {
    session = await connectedClient({ text: "# md" });
    const result = await session.mcp.callTool({ name: "render_report", arguments: { report: sampleReport() as unknown as Record<string, unknown> } });
    expect(textOf(result)).toBe("# md");
  });

  it("unknown id and missing input are explained", async () => {
    session = await connectedClient();
    expect(textOf(await session.mcp.callTool({ name: "render_report", arguments: { report_id: "r_00000000" } }))).toContain("no report r_00000000 in memory");
    expect(textOf(await session.mcp.callTool({ name: "render_report", arguments: { report: { hello: 1 } } }))).toContain("give either report_id");
    expect(session.calls).toHaveLength(0);
  });

  it("402, 429 and network errors surface", async () => {
    session = await connectedClient({ status: 402, body: error402 }, { status: 429, body: error429 }, network);
    const call = () => session!.mcp.callTool({ name: "render_report", arguments: { report: sampleReport() as unknown as Record<string, unknown> } });
    expect(textOf(await call())).toContain("needs the solo plan");
    expect(textOf(await call())).toContain("rate limit");
    expect(textOf(await call())).toContain("Could not reach");
  });
});
