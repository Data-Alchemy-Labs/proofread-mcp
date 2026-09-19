// Live smoke against https://proofread.law (or PROOFREAD_API). Run with: LIVE=1 npm test -- test/live.test.ts
// Each check_citations / resolve_citation call counts against the free tier (20 an hour per IP).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { textOf } from "./helpers.js";

const SAMPLE = "Title VII forbids discrimination because of sexual orientation. Bostock v. Clayton County, 509 U.S. 644 (2020).";

describe.skipIf(!process.env.LIVE)("live: proofread.law", () => {
  const mcp = new Client({ name: "live-test", version: "0" });
  const server = createServer();
  beforeAll(async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await mcp.connect(a);
  });
  afterAll(async () => {
    await mcp.close();
    await server.close();
  });

  it("coverage carries the register size and the Westlaw/Lexis caveat", async () => {
    const text = textOf(await mcp.callTool({ name: "coverage", arguments: {} }));
    expect(text).toMatch(/^Coverage: Checked against [\d.]+ M cases/);
    expect(text).toContain("Westlaw/Lexis identifiers are not resolvable");
    expect(text).toContain("Storage: Nothing you submit is stored");
  });

  it("check_citations flags the Bostock volume typo as check this, never as fabricated", async () => {
    const result = await mcp.callTool({ name: "check_citations", arguments: { text: SAMPLE } });
    const text = textOf(result);
    console.log(text);
    expect(result.isError).toBeFalsy();
    expect(text).toMatch(/^Coverage: /);
    expect(text).toContain("- CHECK THIS: 509 U.S. 644");
    expect(text).toContain("590 U.S. 644");
    expect(text.toLowerCase()).not.toMatch(/fabricat|fake/);
    expect(text).toMatch(/Report id: r_[0-9a-f]{8}/);
    const id = /Report id: (r_[0-9a-f]{8})/.exec(text)![1]!;
    const md = textOf(await mcp.callTool({ name: "render_report", arguments: { report_id: id } }));
    expect(md).toContain("509 U.S. 644");
  });

  it("resolve_citation finds Bostock at 590 U.S. 644", async () => {
    const text = textOf(await mcp.callTool({ name: "resolve_citation", arguments: { citation: "Bostock v. Clayton County, 590 U.S. 644 (2020)" } }));
    console.log(text);
    expect(text).toMatch(/^FOUND: 590 U\.S\. 644/);
    expect(text).toContain("Coverage:");
  });
});
