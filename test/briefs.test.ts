import { afterEach, describe, expect, it } from "vitest";
import { formatChanges, summaryCounts } from "../src/briefs_format.js";
import { createClient } from "../src/client.js";
import { INSTRUCTIONS } from "../src/server.js";
import { tools } from "../src/tools/index.js";
import type { Report } from "../src/types.js";
import { connectedClient, connectedClientWith, error429, mockFetch, sampleReport, textOf } from "./helpers.js";

// Answers in the shape of proofread-law's /v1/briefs (CONTRACTS.md 2026-09-24): integer ids, `versions` a count in the list and an
// array newest first in GET one, changes as {citation, parties, tier, headline}, DELETE 204, 404 no_brief, 409 brief_limit, 503 storage_off.

type Connected = Awaited<ReturnType<typeof connectedClient>>;
let session: Connected | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

const BRIEF_TOOLS = ["save_brief", "list_briefs", "get_brief", "update_brief", "delete_brief"];
const TEXT = "Title VII forbids discrimination because of sexual orientation. Bostock v. Clayton County, 509 U.S. 644 (2020). See 2023 WL 123456.";
const storageOff = { status: 503, body: { error: { code: "storage_off", message: "saved briefs are switched off on this server" } } };
const notFound = { status: 404, body: { error: { code: "no_brief", message: "no such brief" } } };
const briefLimit = { status: 409, body: { error: { code: "brief_limit", plan: "free", limit: 3 } } }; // the API sends no message field
const STORAGE_OFF_TEXT = "proofread.law: saved briefs are switched off on this server, so nothing was saved or read. check_citations still checks a text without saving it.";

function savedBody(report: Report = sampleReport()) {
  return { id: 17, title: "Motion to dismiss", created_at: "2026-09-24T10:00:00Z", updated_at: "2026-09-24T10:00:00Z", summary: report.summary, report };
}

function briefBody(text = TEXT) {
  const report = sampleReport();
  return {
    id: 17, title: "Motion to dismiss", text, report, summary: report.summary, updated_at: "2026-09-24T10:05:00Z",
    versions: [ // newest first, as the API sends them
      { v: 2, created_at: "2026-09-24T10:05:00Z", summary: report.summary },
      { v: 1, created_at: "2026-09-24T10:00:00Z", summary: { citations: 4, rows: 4, red: 2, orange: 2, green: 0, white: 0 } },
    ],
  };
}

/** A flagged row as PUT's changes carry it. */
const item = (r: Report["rows"][number]) => ({ citation: r.citation, parties: r.parties ?? null, tier: r.tier, headline: r.headline });

/** After the edit: the Bostock row is no longer flagged and a new red row appeared. */
function updatedBody() {
  const before = sampleReport();
  const after = sampleReport();
  after.rows[0] = { ...after.rows[0]!, citation: "590 U.S. 1", cite: "590 U.S. 1", parties: "Doe v. Roe", year: 2021, occurrences: 1,
    headline: "Register has a different case at 590 U.S. 1. Check the citation", detail: "In the register, 590 U.S. 1 is Smith v. Jones." };
  return {
    ...briefBody("edited text"), report: after, summary: after.summary, updated_at: "2026-09-24T10:20:00Z",
    versions: [{ v: 3, created_at: "2026-09-24T10:20:00Z", summary: after.summary }, ...briefBody().versions],
    changes: { resolved: [item(before.rows[0]!)], new: [item(after.rows[0]!)], unchanged: 2 },
  };
}

/** The product's wording rules on every user-facing string: no dashes as punctuation, never "fabricated", no verdict on the author. */
function expectPlain(text: string): void {
  expect(text).not.toMatch(/[\u2013\u2014]/);
  expect(text.toLowerCase()).not.toMatch(/fabricat|fake|hallucinat|bogus|\bwrong\b|\binvalid\b|\bincorrect\b/);
}

const auth = (i: number) => (session!.calls[i]!.init.headers as Record<string, string>).Authorization;

describe("saved-brief tools: descriptions and wording", () => {
  const byName = new Map(tools.map((t) => [t.name, t]));

  it("each says saving is opt-in, stored encrypted in the user's account, and nothing is saved unless a saving tool is called", () => {
    for (const name of BRIEF_TOOLS) {
      const d = byName.get(name)!.description;
      expect(d, name).toContain("Saving is opt-in");
      expect(d, name).toContain("stored encrypted in the user's proofread.law account");
      expect(d, name).toContain("nothing is saved unless save_brief or update_brief is called");
    }
    for (const name of ["list_briefs", "get_brief"]) expect(byName.get(name)!.description).toContain("this tool saves nothing");
  });

  it("update_brief describes the edit-and-recheck loop; delete_brief says permanent", () => {
    const u = byName.get("update_brief")!.description;
    expect(u).toContain("This is the loop for fixing flagged citations: edit the text");
    expect(u).toContain("call update_brief with the whole edited text, and read the changes");
    expect(u).toMatch(/resolved.*new/);
    expect(byName.get("delete_brief")!.description).toMatch(/^Permanently delete/);
    expect(byName.get("delete_brief")!.description).toContain("The deletion is permanent");
  });

  it("no em or en dashes, never fabricated, no verdict words in any tool's title or description, or in the instructions", () => {
    for (const t of tools) {
      expectPlain(t.title);
      expectPlain(t.description);
    }
    expect(INSTRUCTIONS).not.toMatch(/[\u2013\u2014]/);
    expect(INSTRUCTIONS.toLowerCase()).not.toMatch(/fabricat|fake/);
  });

  it("the server instructions mention the edit-and-recheck loop", () => {
    expect(INSTRUCTIONS).toContain("Saved briefs are opt-in and stored encrypted in the user's account");
    expect(INSTRUCTIONS).toContain("edit the text, call update_brief with the brief id and the whole edited text, and read what changed");
  });

  it("without an API key nothing is sent: every brief tool answers with the key message", async () => {
    session = await connectedClientWith({}, { body: savedBody() });
    const args: Record<string, Record<string, unknown>> = {
      save_brief: { text: TEXT }, list_briefs: {}, get_brief: { id: "17" }, update_brief: { id: "17", text: "x" }, delete_brief: { id: "17" },
    };
    for (const name of BRIEF_TOOLS) {
      const result = await session.mcp.callTool({ name, arguments: args[name] });
      expect(result.isError, name).toBe(true);
      expect(textOf(result)).toBe("Saved briefs live in a proofread.law account, so they need an API key: set PROOFREAD_API_KEY, or call sign_up first to create an account and key. Nothing was sent or saved.");
    }
    expect(session.calls).toHaveLength(0);
  });

  it("an id that is not a plain token is refused at the schema, without a call", async () => {
    session = await connectedClient({ body: briefBody() });
    for (const id of ["../me", "b 1", "", "a/b"]) {
      expect((await session.mcp.callTool({ name: "get_brief", arguments: { id } })).isError, id).toBe(true);
      expect((await session.mcp.callTool({ name: "delete_brief", arguments: { id } })).isError, id).toBe(true);
    }
    expect(session.calls).toHaveLength(0);
  });
});

describe("save_brief", () => {
  it("POSTs /v1/briefs with the key and returns the id, the compact report and the next step; the report id works in render_report", async () => {
    session = await connectedClient({ status: 201, body: savedBody() }, { text: "# report" });
    const result = await session.mcp.callTool({ name: "save_brief", arguments: { text: TEXT, title: "Motion to dismiss" } });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    const lines = text.split("\n");
    expect(lines[0]).toBe('Saved brief 17 "Motion to dismiss" to your proofread.law account (stored encrypted; delete_brief removes it permanently).');
    expect(lines[1]).toMatch(/^Coverage: Checked against 10\.1 M cases/);
    expect(lines[2]).toBe("Summary: 4 citations, 4 rows. Check this (red): 1. Cannot verify (orange): 2, of which 2 Westlaw/Lexis identifiers. Found (green): 1.");
    expect(text).toContain("- CHECK THIS: 509 U.S. 644 (Bostock v. Clayton County, 2020) [cited 2 times].");
    expect(lines.at(-1)).toBe("Next: edit the text, then call update_brief with id 17 and the whole edited text; it saves a new version, re-checks it and says which flags were resolved and which are new.");
    expectPlain(text);
    expect(session.calls[0]?.url).toBe("https://api.test/v1/briefs");
    expect(session.calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(session.calls[0]!.init.body))).toEqual({ text: TEXT, title: "Motion to dismiss" });
    expect(auth(0)).toBe("Bearer pl_test_key");
    const sc = result.structuredContent as { id: string; title: string; summary: { red: number }; report_id: string };
    expect(sc).toMatchObject({ id: "17", title: "Motion to dismiss", summary: { red: 1 } });
    expect(sc.report_id).toMatch(/^r_[0-9a-f]{8}$/);
    expect(text).toContain(`Report id: ${sc.report_id}`);
    const rendered = await session.mcp.callTool({ name: "render_report", arguments: { report_id: sc.report_id } });
    expect(textOf(rendered)).toBe("# report");
    expect(session.calls[1]?.url).toBe("https://api.test/render?format=md");
  });

  it("sends no title when none is given, and an untitled brief reads as such", async () => {
    session = await connectedClient({ status: 201, body: { ...savedBody(), title: null } });
    const text = textOf(await session.mcp.callTool({ name: "save_brief", arguments: { text: TEXT } }));
    expect(JSON.parse(String(session.calls[0]!.init.body))).toEqual({ text: TEXT });
    expect(text.split("\n")[0]).toMatch(/^Saved brief 17 \(untitled\) to your proofread.law account/);
  });

  it("404 (a server without saved briefs) says nothing was saved", async () => {
    session = await connectedClient(notFound);
    const result = await session.mcp.callTool({ name: "save_brief", arguments: { text: TEXT } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("This proofread.law server does not offer saved briefs (HTTP 404), so nothing was saved. check_citations still checks a text without saving it.");
  });

  it("503 storage_off says saving is switched off and points at check_citations", async () => {
    session = await connectedClient(storageOff);
    const result = await session.mcp.callTool({ name: "save_brief", arguments: { text: TEXT } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(STORAGE_OFF_TEXT);
  });

  it("409 brief_limit (no message field) says the plan's limit is reached and what to do", async () => {
    session = await connectedClient(briefLimit);
    const result = await session.mcp.callTool({ name: "save_brief", arguments: { text: TEXT } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("proofread.law: this plan's saved-brief limit is reached. Delete an old brief with delete_brief, or upgrade at https://proofread.law/pricing.");
    expectPlain(textOf(result));
  });

  it("an integer id from the API comes back as a string, and get_brief takes it as \"42\"", async () => {
    session = await connectedClient({ status: 201, body: { ...savedBody(), id: 42 } }, { body: { ...briefBody(), id: 42 } });
    const saved = await session.mcp.callTool({ name: "save_brief", arguments: { text: TEXT } });
    expect((saved.structuredContent as { id: unknown }).id).toBe("42");
    expect(textOf(saved).split("\n")[0]).toMatch(/^Saved brief 42 "Motion to dismiss"/);
    const got = await session.mcp.callTool({ name: "get_brief", arguments: { id: "42" } });
    expect(got.isError).toBeFalsy();
    expect(session.calls[1]?.url).toBe("https://api.test/v1/briefs/42");
    expect((got.structuredContent as { id: unknown }).id).toBe("42");
    expect(textOf(got).split("\n")[0]).toMatch(/^Brief 42 "Motion to dismiss"/);
  });

  it("401, quota and rate-limit errors read as they do for a check", async () => {
    session = await connectedClient(
      { status: 401, body: { error: { code: "bad_key", message: "unknown, revoked, or no longer active API key" } } },
      { status: 429, body: { error: { code: "quota_exceeded", message: "20 checks a month on the Free plan", plan: "free", used: 20, limit: 20, upgrade: "/pricing" } } },
      { status: 429, body: error429 });
    const call = () => session!.mcp.callTool({ name: "save_brief", arguments: { text: TEXT } });
    expect(textOf(await call())).toBe("proofread.law rejected the API key in PROOFREAD_API_KEY (unknown or revoked).");
    expect(textOf(await call())).toContain("monthly allowance used (20 of 20)");
    expect(textOf(await call())).toContain("Retry after 3565 s");
  });
});

describe("list_briefs", () => {
  const list = {
    briefs: [
      { id: "17", title: "Motion to dismiss", created_at: "2026-09-24T10:00:00Z", updated_at: "2026-09-24T10:05:00Z", last_checked_at: "2026-09-24T10:05:00Z",
        n_citations: 4, summary: { citations: 4, rows: 4, red: 1, orange: 2, green: 1, white: 0 }, versions: 2 },
      { id: 18, title: null, updated_at: "2026-09-20T08:00:00+00:00", last_checked_at: null, n_citations: 0, summary: null, versions: 1 },
    ],
  };

  it("GETs /v1/briefs and lists one line per brief", async () => {
    session = await connectedClient({ body: list });
    const result = await session.mcp.callTool({ name: "list_briefs", arguments: {} });
    const text = textOf(result);
    expect(text.split("\n")).toEqual([
      "2 saved briefs in your proofread.law account (stored encrypted):",
      '- 17 "Motion to dismiss": 4 citations: check this (red) 1, cannot verify (orange) 2, found (green) 1. Saved 2026-09-24 10:05 UTC, last checked 2026-09-24 10:05 UTC, 2 versions.',
      "- 18 (untitled): 0 citations. Saved 2026-09-20 08:00 UTC, 1 version.",
      "get_brief gives a brief's saved text and latest report; update_brief saves an edited version and re-checks it.",
    ]);
    expectPlain(text);
    expect(session.calls[0]?.url).toBe("https://api.test/v1/briefs");
    expect(session.calls[0]?.init.method).toBe("GET");
    expect(auth(0)).toBe("Bearer pl_test_key");
    expect((result.structuredContent as { briefs: unknown[] }).briefs).toEqual([
      { id: "17", title: "Motion to dismiss", updated_at: "2026-09-24T10:05:00Z", last_checked_at: "2026-09-24T10:05:00Z", n_citations: 4, versions: 2 },
      { id: "18", title: null, updated_at: "2026-09-20T08:00:00+00:00", last_checked_at: null, n_citations: 0, versions: 1 },
    ]);
  });

  it("an empty account says how to save one", async () => {
    session = await connectedClient({ body: { briefs: [] } });
    expect(textOf(await session.mcp.callTool({ name: "list_briefs", arguments: {} })))
      .toBe("No saved briefs in this proofread.law account. save_brief saves one (opt-in, stored encrypted in the account).");
  });

  it("404 and storage_off surface", async () => {
    session = await connectedClient(notFound, storageOff);
    const first = await session.mcp.callTool({ name: "list_briefs", arguments: {} });
    expect(first.isError).toBe(true);
    expect(textOf(first)).toMatch(/^This proofread.law server does not offer saved briefs \(HTTP 404\)/);
    expect(textOf(await session.mcp.callTool({ name: "list_briefs", arguments: {} }))).toBe(STORAGE_OFF_TEXT);
  });
});

describe("get_brief", () => {
  it("GETs /v1/briefs/{id} and returns the versions, the latest report and the whole saved text between markers", async () => {
    session = await connectedClient({ body: briefBody() });
    const result = await session.mcp.callTool({ name: "get_brief", arguments: { id: "17" } });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    const lines = text.split("\n");
    expect(lines[0]).toBe('Brief 17 "Motion to dismiss", saved 2026-09-24 10:05 UTC, version 2 (2 versions kept).');
    expect(lines[1]).toBe("Versions: v1 2026-09-24 10:00 UTC (4 citations: check this (red) 2, cannot verify (orange) 2, found (green) 0); " +
      "v2 2026-09-24 10:05 UTC (4 citations: check this (red) 1, cannot verify (orange) 2, found (green) 1). get_brief with version gives an earlier text.");
    expect(lines[2]).toBe("Latest check:");
    expect(lines[3]).toMatch(/^Coverage: /);
    expect(text).toContain("- CHECK THIS: 509 U.S. 644");
    expect(text).toContain(`Saved text (version 2, ${TEXT.length} characters). To fix a flagged row, edit this text and send the whole edited text to update_brief:`);
    expect(text.endsWith(`--- saved text begins ---\n${TEXT}\n--- saved text ends ---`)).toBe(true);
    expectPlain(text);
    expect(session.calls[0]?.url).toBe("https://api.test/v1/briefs/17");
    expect(session.calls[0]?.init.method).toBe("GET");
    expect(result.structuredContent).toMatchObject({ id: "17", title: "Motion to dismiss", summary: { red: 1 }, versions: [{ v: 2 }, { v: 1 }], text_included: true });
  });

  it("include_text=false leaves the text out; a long text is never cut", async () => {
    session = await connectedClient({ body: briefBody() }, { body: briefBody("See 509 U.S. 644. ".repeat(5000)) });
    const short = textOf(await session.mcp.callTool({ name: "get_brief", arguments: { id: "17", include_text: false } }));
    expect(short).not.toContain(TEXT);
    expect(short).not.toContain("--- saved text begins ---");
    expect(short.split("\n").at(-1)).toBe("Text not included (include_text=false); get_brief with include_text=true returns it.");
    const long = textOf(await session.mcp.callTool({ name: "get_brief", arguments: { id: "17" } }));
    expect(long).toContain(`--- saved text begins ---\n${"See 509 U.S. 644. ".repeat(5000)}\n--- saved text ends ---`);
  });

  it("version GETs /v1/briefs/{id}/versions/{v} and returns that text", async () => {
    session = await connectedClient({ body: { v: 1, created_at: "2026-09-24T10:00:00Z", text: "first draft", summary: { citations: 4, red: 2, orange: 2, green: 0 } } });
    const result = await session.mcp.callTool({ name: "get_brief", arguments: { id: "17", version: 1 } });
    expect(session.calls[0]?.url).toBe("https://api.test/v1/briefs/17/versions/1");
    expect(textOf(result)).toBe([
      "Brief 17, version 1, saved 2026-09-24 10:00 UTC: 4 citations: check this (red) 2, cannot verify (orange) 2, found (green) 0.",
      "This is an earlier version as it was saved; get_brief without a version gives the latest text and report. To go back to this text, send it to update_brief.",
      "--- text of version 1 begins ---",
      "first draft",
      "--- text of version 1 ends ---",
    ].join("\n"));
    expect(result.structuredContent).toMatchObject({ id: "17", version: 1 });
  });

  it("404 names the id (the API answers 404 for another account's id too), and the version when one was asked for", async () => {
    session = await connectedClient(notFound);
    const missing = await session.mcp.callTool({ name: "get_brief", arguments: { id: "b_nope" } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe("No saved brief b_nope in this account. list_briefs shows the ids of the saved briefs.");
    expect(textOf(await session.mcp.callTool({ name: "get_brief", arguments: { id: "17", version: 9 } })))
      .toBe("No version 9 of saved brief 17 in this account. get_brief without a version lists the versions kept.");
  });

  it("storage_off surfaces", async () => {
    session = await connectedClient(storageOff);
    const result = await session.mcp.callTool({ name: "get_brief", arguments: { id: "17" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(STORAGE_OFF_TEXT);
  });
});

describe("update_brief", () => {
  it("PUTs the edited text and returns the changes (resolved, new, unchanged) and then every row that still needs attention", async () => {
    session = await connectedClient({ body: updatedBody() });
    const result = await session.mcp.callTool({ name: "update_brief", arguments: { id: "17", text: "edited text" } });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    const lines = text.split("\n");
    expect(lines.slice(0, 7)).toEqual([
      'Saved brief 17 "Motion to dismiss" as version 3 and re-checked it.',
      "Changes since the previous version: 1 resolved, 1 new, 2 rows unchanged.",
      "Resolved (1): flagged in the previous version, not flagged now (the citation was changed or taken out):",
      "- 509 U.S. 644 (Bostock v. Clayton County), was check this (red): Register has Bostock v. Clayton County at 590 U.S. 644. Check the volume.",
      "New flags (1): not flagged in the previous version; the full rows are below:",
      "- CHECK THIS: 590 U.S. 1 (Doe v. Roe): Register has a different case at 590 U.S. 1. Check the citation.",
      "Latest check (every row that still needs attention):",
    ]);
    expect(lines[7]).toMatch(/^Coverage: /);
    expect(text).toContain("- CHECK THIS: 590 U.S. 1 (Doe v. Roe, 2021). Register has a different case at 590 U.S. 1. Check the citation. In the register, 590 U.S. 1 is Smith v. Jones.");
    expect(lines.at(-1)).toBe("Next: fix what is still flagged in the text and call update_brief with id 17 again, or stop when every remaining row has been reviewed.");
    expectPlain(text);
    expect(session.calls[0]?.url).toBe("https://api.test/v1/briefs/17");
    expect(session.calls[0]?.init.method).toBe("PUT");
    expect(JSON.parse(String(session.calls[0]!.init.body))).toEqual({ text: "edited text" });
    expect(auth(0)).toBe("Bearer pl_test_key");
    expect(result.structuredContent).toMatchObject({ id: "17", version: 3, rechecked: true, changes: { resolved: 1, new: 1, unchanged: 2 }, summary: { red: 1 } });
    expect((result.structuredContent as { report_id: string }).report_id).toMatch(/^r_[0-9a-f]{8}$/);
  });

  it("changes given as plain citation strings are listed as they are", async () => {
    session = await connectedClient({ body: { ...updatedBody(), changes: { resolved: ["509 U.S. 644"], new: [], unchanged: 3 } } });
    const text = textOf(await session.mcp.callTool({ name: "update_brief", arguments: { id: "17", text: "edited text" } }));
    expect(text).toContain("Changes since the previous version: 1 resolved, 0 new, 3 rows unchanged.\nResolved (1): flagged in the previous version, not flagged now (the citation was changed or taken out):\n- 509 U.S. 644\nLatest check");
    expect(text).not.toContain("New flags");
  });

  it("a resolved item carries its headline after a colon; items with null fields still read", async () => {
    const changes = {
      resolved: [{ citation: "2023 WL 123456", parties: null, tier: "orange", headline: "Westlaw/Lexis identifier. Open registers cannot resolve it" }],
      new: [{ citation: null, parties: null, tier: "red", headline: null }],
      unchanged: 1,
    };
    session = await connectedClient({ body: { ...updatedBody(), changes } });
    const text = textOf(await session.mcp.callTool({ name: "update_brief", arguments: { id: "17", text: "edited text" } }));
    expect(text).toContain("\n- 2023 WL 123456, was cannot verify (orange): Westlaw/Lexis identifier. Open registers cannot resolve it.\n");
    expect(text).toContain("\n- CHECK THIS: (citation not given)\n");
    expectPlain(text);
  });

  it("recheck=true re-runs the check on the saved text: the body carries recheck, the first line says re-checked", async () => {
    session = await connectedClient({ body: { ...updatedBody(), text: TEXT } });
    const result = await session.mcp.callTool({ name: "update_brief", arguments: { id: "17", recheck: true } });
    expect(JSON.parse(String(session.calls[0]!.init.body))).toEqual({ recheck: true });
    const lines = textOf(result).split("\n");
    expect(lines[0]).toBe('Re-checked the saved text of brief 17 "Motion to dismiss" (kept as version 3).');
    expect(lines[1]).toBe("Changes since the previous version: 1 resolved, 1 new, 2 rows unchanged.");
    expect(result.structuredContent).toMatchObject({ id: "17", rechecked: true, changes: { resolved: 1, new: 1, unchanged: 2 } });
  });

  it("recheck=false is not sent", async () => {
    session = await connectedClient({ body: updatedBody() });
    await session.mcp.callTool({ name: "update_brief", arguments: { id: "17", text: "edited text", recheck: false } });
    expect(JSON.parse(String(session.calls[0]!.init.body))).toEqual({ text: "edited text" });
  });

  it("a title alone renames without a check (the API answers changes: null)", async () => {
    session = await connectedClient({ body: { ...updatedBody(), title: "MTD, final", changes: null } });
    const result = await session.mcp.callTool({ name: "update_brief", arguments: { id: "17", title: "MTD, final" } });
    expect(JSON.parse(String(session.calls[0]!.init.body))).toEqual({ title: "MTD, final" });
    expect(textOf(result)).toBe('Renamed brief 17 "MTD, final"; the text did not change, so it was not re-checked and no version was added. ' +
      "Latest counts: 4 citations: check this (red) 1, cannot verify (orange) 2, found (green) 1. get_brief shows the latest report.");
    expect(result.structuredContent).toMatchObject({ rechecked: false, changes: null, report_id: null });
  });

  it("the same text without recheck is not re-checked, and the line points at recheck", async () => {
    session = await connectedClient({ body: { ...briefBody(), changes: null } });
    const text = textOf(await session.mcp.callTool({ name: "update_brief", arguments: { id: "17", text: TEXT } }));
    expect(text).toMatch(/^Brief 17 "Motion to dismiss" is unchanged; the text is the same as the saved version, so it was not re-checked and no version was added \(recheck=true re-runs the check\)\./);
  });

  it("neither text, title nor recheck is refused without a call", async () => {
    session = await connectedClient({ body: updatedBody() });
    for (const args of [{ id: "17" }, { id: "17", recheck: false }]) {
      const result = await session.mcp.callTool({ name: "update_brief", arguments: args });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("give text (the whole edited brief), title (a new name), or recheck=true (check the saved text again).");
    }
    expect(session.calls).toHaveLength(0);
  });

  it("404 names the id; storage_off surfaces", async () => {
    session = await connectedClient(notFound, storageOff);
    const missing = await session.mcp.callTool({ name: "update_brief", arguments: { id: "b_gone", text: "x" } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe("No saved brief b_gone in this account. list_briefs shows the ids of the saved briefs.");
    const off = await session.mcp.callTool({ name: "update_brief", arguments: { id: "17", text: "x" } });
    expect(off.isError).toBe(true);
    expect(textOf(off)).toBe(STORAGE_OFF_TEXT);
  });
});

describe("delete_brief", () => {
  it("DELETEs /v1/briefs/{id}; a 204 is reported as a permanent deletion", async () => {
    session = await connectedClient({ response: new Response(null, { status: 204 }) });
    const result = await session.mcp.callTool({ name: "delete_brief", arguments: { id: "17" } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe("Deleted brief 17 and its saved versions from your proofread.law account. This is permanent; they cannot be restored.");
    expect(result.structuredContent).toEqual({ id: "17", deleted: true });
    expect(session.calls[0]?.url).toBe("https://api.test/v1/briefs/17");
    expect(session.calls[0]?.init.method).toBe("DELETE");
    expect(auth(0)).toBe("Bearer pl_test_key");
  });

  it("404 names the id; storage_off surfaces", async () => {
    session = await connectedClient(notFound, storageOff);
    const missing = await session.mcp.callTool({ name: "delete_brief", arguments: { id: "b_gone" } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe("No saved brief b_gone in this account. list_briefs shows the ids of the saved briefs.");
    const off = await session.mcp.callTool({ name: "delete_brief", arguments: { id: "17" } });
    expect(off.isError).toBe(true);
    expect(textOf(off)).toBe(STORAGE_OFF_TEXT);
  });
});

describe("client: brief routes", () => {
  const cfg = { baseUrl: "https://api.test", apiKey: "pl_k" };

  it("refuses an id that would change the path before calling", async () => {
    const { fetch, calls } = mockFetch({ body: briefBody() });
    const c = createClient(cfg, fetch);
    for (const id of ["..", "../account", "a/b", "b%2F1", ""]) {
      expect((await c.getBrief(id).catch((e) => e)).code, id).toBe("bad_brief_id");
      expect((await c.deleteBrief(id).catch((e) => e)).code, id).toBe("bad_brief_id");
    }
    expect(calls).toHaveLength(0);
  });

  it("an answer without an id or a report of the /verify shape is a clear error", async () => {
    expect((await createClient(cfg, mockFetch({ body: { title: "x" } }).fetch).saveBrief("t").catch((e) => e)).message).toContain("unexpected shape (no brief id)");
    expect((await createClient(cfg, mockFetch({ body: { id: "b_1", report: {} } }).fetch).saveBrief("t").catch((e) => e)).message).toContain("unexpected shape (no summary)");
    expect((await createClient(cfg, mockFetch({ body: { items: [] } }).fetch).listBriefs().catch((e) => e)).message).toContain("unexpected shape (no briefs list)");
    const badChanges = { ...briefBody(), changes: { resolved: 1 } };
    expect((await createClient(cfg, mockFetch({ body: badChanges }).fetch).updateBrief("b_1", { text: "x" }).catch((e) => e)).message)
      .toContain("unexpected shape (changes without resolved and new lists)");
    expect((await createClient(cfg, mockFetch({ body: { v: 1 } }).fetch).getBriefVersion("b_1", 1).catch((e) => e)).message).toContain("unexpected shape (no version text)");
  });

  it("integer ids become strings on every brief answer (POST, GET list, GET one, PUT)", async () => {
    const { fetch } = mockFetch({ body: { ...savedBody(), id: 42 } }, { body: { briefs: [{ id: 42 }, { id: 43 }], limit: 3 } }, { body: { ...briefBody(), id: 42 } },
      { body: { ...updatedBody(), id: 42 } });
    const c = createClient(cfg, fetch);
    expect((await c.saveBrief("t")).id).toBe("42");
    expect((await c.listBriefs()).briefs.map((b) => b.id)).toEqual(["42", "43"]);
    expect((await c.getBrief("42")).id).toBe("42");
    expect((await c.updateBrief("42", { recheck: true })).id).toBe("42");
  });

  it("a list entry without an id is a clear error", async () => {
    expect((await createClient(cfg, mockFetch({ body: { briefs: [{ title: "x" }] } }).fetch).listBriefs().catch((e) => e)).message).toContain("unexpected shape (a brief without an id)");
  });
});

describe("briefs_format", () => {
  it("summaryCounts reads whatever counts are there, and shows white only when deep rows exist", () => {
    expect(summaryCounts({ citations: 1, red: 0, orange: 0, green: 1, white: 0 })).toBe("1 citation: check this (red) 0, cannot verify (orange) 0, found (green) 1");
    expect(summaryCounts({ citations: 2, red: 0, orange: 0, green: 0, white: 2 })).toBe("2 citations: check this (red) 0, cannot verify (orange) 0, found (green) 0, deep check (white) 2");
    expect(summaryCounts(null, 7)).toBe("7 citations");
    expect(summaryCounts(undefined)).toBe("no check recorded");
  });

  it("long lists of changed flags are cut with a count; the rows below carry the full list", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ citation: `${i + 1} F.4th ${i + 100}`, parties: `Party ${i} v. Party ${i + 1}`, tier: "orange" as const }));
    const lines = formatChanges({ resolved: many, new: many, unchanged: 0 });
    expect(lines[0]).toBe("Changes since the previous version: 400 resolved, 400 new, 0 rows unchanged.");
    expect(lines.join("\n").length).toBeLessThan(2 * 4_000 + 600);
    expect(lines.filter((l) => /^\.\.\. and \d+ more resolved flags\.$/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => /^\.\.\. and \d+ more new flags\.$/.test(l))).toHaveLength(1);
  });
});
