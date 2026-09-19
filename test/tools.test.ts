import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectedClient, error402, error429, sampleReport, sseBody, textOf } from "./helpers.js";

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
    expect(tools.map((t) => t.name)).toEqual(["check_citations", "check_document", "resolve_citation", "coverage", "render_report"]);
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(80);
      expect(t.annotations?.readOnlyHint).toBe(true);
    }
    const check = tools.find((t) => t.name === "check_citations")!;
    expect(check.description).toContain("Westlaw");
    expect(check.description).toContain("statutes");
    expect(check.description?.toLowerCase()).not.toMatch(/fabricat|fake/);
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
  it("returns one row in detail with the coverage statement", async () => {
    session = await connectedClient({ body: sampleReport() });
    const result = await session.mcp.callTool({ name: "resolve_citation", arguments: { citation: "Bostock v. Clayton County, 509 U.S. 644 (2020)" } });
    const text = textOf(result);
    expect(text.split("\n")[0]).toBe("CHECK THIS: 509 U.S. 644 (Bostock v. Clayton County, 2020)");
    expect(text).toContain("Evidence: register name: Bostock v. Clayton County");
    expect(text).toContain("(3 more citations in the input; showing the first.");
    expect(text).toMatch(/\nCoverage: Checked against/);
    expect(JSON.parse(String(session.calls[0]!.init.body))).toEqual({ text: "Bostock v. Clayton County, 509 U.S. 644 (2020)" });
  });

  it("says when no citation was recognised", async () => {
    const empty = { ...sampleReport(), rows: [], summary: { ...sampleReport().summary, citations: 0, rows: 0, red: 0, orange: 0, green: 0 } };
    session = await connectedClient({ body: empty });
    const text = textOf(await session.mcp.callTool({ name: "resolve_citation", arguments: { citation: "hello there" } }));
    expect(text).toContain('No case citation was recognised in: "hello there"');
    expect(text).toContain("Coverage:");
  });

  it("402, 429 and network errors surface", async () => {
    session = await connectedClient({ status: 402, body: error402 }, { status: 429, body: error429 }, network);
    const call = () => session!.mcp.callTool({ name: "resolve_citation", arguments: { citation: "1 U.S. 1" } });
    expect(textOf(await call())).toContain("needs the solo plan");
    expect(textOf(await call())).toContain("rate limit");
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
    expect((await call()).isError).toBe(true);
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
