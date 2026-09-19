import { describe, expect, it } from "vitest";
import { anySignal, createClient, verifyPath } from "../src/client.js";
import { ProofreadError } from "../src/errors.js";
import { error402, error429, mockFetch, resolveBatch, resolveResult, sampleReport, sseBody } from "./helpers.js";

const cfg = { baseUrl: "https://api.test" };

describe("verifyPath: SSE vs one JSON", () => {
  it("default check has no query", () => expect(verifyPath(false, false)).toBe("/verify"));
  it("deep without a row listener asks for one JSON", () => expect(verifyPath(true, false)).toBe("/verify?deep=1&stream=0"));
  it("deep with a row listener streams", () => expect(verifyPath(true, true)).toBe("/verify?deep=1"));
});

describe("verifyText", () => {
  it("posts JSON and returns the report", async () => {
    const { fetch, calls } = mockFetch({ body: sampleReport() });
    const report = await createClient(cfg, fetch).verifyText("509 U.S. 644");
    expect(report.summary.red).toBe(1);
    expect(calls[0]?.url).toBe("https://api.test/verify");
    const init = calls[0]!.init;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ text: "509 U.S. 644" });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("sends the API key only when configured", async () => {
    const a = mockFetch({ body: sampleReport() });
    await createClient(cfg, a.fetch).verifyText("x");
    expect((a.calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    const b = mockFetch({ body: sampleReport() });
    await createClient({ ...cfg, apiKey: "pl_abc_def" }, b.fetch).verifyText("x");
    expect((b.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer pl_abc_def");
  });

  it("deep with onRow reads the SSE stream, merges rows and the done summary", async () => {
    const provisional = sampleReport();
    provisional.mode = "deep";
    provisional.summary.deep_pending = 1;
    const finished = { ...provisional.rows[3]!, tier: "white" as const, support: { status: "confirmed" as const, headline: "Passage found that states this", confidence: 0.97 } };
    const body = sseBody(provisional, [finished], { summary: { white: 1, green: 0, deep_pending: 0 }, elapsed_s: 3.9 });
    const { fetch, calls } = mockFetch({ text: body, headers: { "content-type": "text/event-stream" } });
    const seen: string[] = [];
    const report = await createClient(cfg, fetch).verifyText("x", { deep: true, onRow: (row) => seen.push(row.citation) });
    expect(calls[0]?.url).toBe("https://api.test/verify?deep=1");
    expect(seen).toEqual(["347 U.S. 483"]);
    expect(report.rows.find((r) => r.n === 5)?.tier).toBe("white");
    expect(report.summary.white).toBe(1);
    expect(report.summary.red).toBe(1); // untouched keys survive the merge
    expect(report.elapsed_s).toBe(3.9);
  });

  it("deep without onRow asks for one JSON", async () => {
    const { fetch, calls } = mockFetch({ body: sampleReport() });
    await createClient(cfg, fetch).verifyText("x", { deep: true });
    expect(calls[0]?.url).toBe("https://api.test/verify?deep=1&stream=0");
  });

  it("maps a 402 to plan_required with the plan details", async () => {
    const { fetch } = mockFetch({ status: 402, body: error402 });
    const err = await createClient(cfg, fetch).verifyText("x").catch((e) => e);
    expect(err).toBeInstanceOf(ProofreadError);
    expect(err.status).toBe(402);
    expect(err.code).toBe("plan_required");
    expect(err.info.upgrade).toBe("https://proofread.law/pricing");
  });

  it("maps the real 429 body to rate_limited with retry_after", async () => {
    const { fetch } = mockFetch({ status: 429, body: error429 });
    const err = await createClient(cfg, fetch).verifyText("x").catch((e) => e);
    expect(err.code).toBe("rate_limited");
    expect(err.info.retry_after).toBe(3565);
  });

  it("wraps a network failure with the base URL", async () => {
    const { fetch } = mockFetch({ throws: new TypeError("fetch failed") });
    const err = await createClient(cfg, fetch).verifyText("x").catch((e) => e);
    expect(err.code).toBe("network");
    expect(err.status).toBe(0);
    expect(err.message).toContain("https://api.test");
    expect(err.message).toContain("fetch failed");
  });

  it("a timeout is reported as a timeout, a client cancel as cancelled, not as unreachable", async () => {
    const timeout = mockFetch({ throws: new DOMException("The operation was aborted due to timeout", "TimeoutError") });
    const t = await createClient(cfg, timeout.fetch).verifyText("x").catch((e) => e);
    expect(t.code).toBe("timeout");
    expect(t.message).toContain("no answer from https://api.test in time");
    const abort = mockFetch({ throws: new DOMException("This operation was aborted", "AbortError") });
    const a = await createClient(cfg, abort.fetch).verifyText("x").catch((e) => e);
    expect(a.code).toBe("cancelled");
  });

  it("passes a combined signal (caller + timeout) to fetch", async () => {
    const { fetch, calls } = mockFetch({ body: sampleReport() });
    const controller = new AbortController();
    await createClient(cfg, fetch).verifyText("x", { signal: controller.signal });
    const signal = calls[0]!.init.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    controller.abort(new Error("stop"));
    expect(signal.aborted).toBe(true);
  });

  it("gives a generic code when the error body is not the envelope", async () => {
    const { fetch } = mockFetch({ status: 502, text: "bad gateway", headers: { "content-type": "text/html" } });
    const err = await createClient(cfg, fetch).verifyText("x").catch((e) => e);
    expect(err.code).toBe("http_502");
  });
});

describe("verifyFile", () => {
  it("uploads multipart with the file name and lets fetch set the boundary", async () => {
    const { fetch, calls } = mockFetch({ body: sampleReport() });
    await createClient(cfg, fetch).verifyFile(new TextEncoder().encode("hello 590 U.S. 644"), "brief.txt");
    const init = calls[0]!.init;
    expect(init.body).toBeInstanceOf(FormData);
    const file = (init.body as FormData).get("file") as File;
    expect(file.name).toBe("brief.txt");
    expect(await file.text()).toBe("hello 590 U.S. 644");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("refuses more than 10 MB before uploading", () => {
    const { fetch, calls } = mockFetch({ body: sampleReport() });
    expect(() => createClient(cfg, fetch).verifyFile(new Uint8Array(10 * 1024 * 1024 + 1), "big.pdf")).toThrow(/bytes/);
    expect(calls).toHaveLength(0);
  });
});

describe("resolveV1 and resolveBatch", () => {
  it("GETs /v1/resolve with the citation URL-encoded and the key when set", async () => {
    const { fetch, calls } = mockFetch({ body: resolveResult("found") });
    const r = await createClient({ ...cfg, apiKey: "pl_k" }, fetch).resolveV1("Bostock v. Clayton County, 590 U.S. 644 (2020)");
    expect(r.status).toBe("found");
    expect(r.case?.name).toBe("Bostock v. Clayton County");
    expect(calls[0]?.url).toBe("https://api.test/v1/resolve?cite=Bostock%20v.%20Clayton%20County%2C%20590%20U.S.%20644%20(2020)");
    expect(calls[0]?.init.method).toBe("GET");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer pl_k");
  });

  it("POSTs /v1/resolve with {cites} for a batch and keeps input order", async () => {
    const { fetch, calls } = mockFetch({ body: resolveBatch() });
    const b = await createClient(cfg, fetch).resolveBatch(["590 U.S. 644", "2023 WL 4567890"]);
    expect(b.results.map((r) => r.status)).toEqual(["found", "found", "ambiguous", "not_found", "beyond_register", "unresolvable", "unparsed"]);
    expect(calls[0]?.url).toBe("https://api.test/v1/resolve");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ cites: ["590 U.S. 644", "2023 WL 4567890"] });
  });

  it("refuses more than 500 citations before calling", async () => {
    const { fetch, calls } = mockFetch({ body: resolveBatch() });
    const err = await createClient(cfg, fetch).resolveBatch(new Array(501).fill("1 U.S. 1")).catch((e) => e);
    expect(err.code).toBe("too_many");
    expect(calls).toHaveLength(0);
  });

  it("maps 400 missing_cite, 429 and network failures", async () => {
    const c = (a: Parameters<typeof mockFetch>[0]) => createClient(cfg, mockFetch(a).fetch);
    expect((await c({ status: 400, body: { error: { code: "missing_cite", message: "send ?cite=590+U.S.+644" } } }).resolveV1("x").catch((e) => e)).code).toBe("missing_cite");
    expect((await c({ status: 429, body: error429 }).resolveV1("x").catch((e) => e)).code).toBe("rate_limited");
    expect((await c({ throws: new TypeError("fetch failed") }).resolveBatch(["x"]).catch((e) => e)).code).toBe("network");
  });
});

describe("renderMarkdown, coverage", () => {

  it("renderMarkdown posts the report to /render?format=md and returns text", async () => {
    const { fetch, calls } = mockFetch({ text: "# proofread.law report\n" });
    const md = await createClient(cfg, fetch).renderMarkdown(sampleReport());
    expect(md).toMatch(/^# proofread/);
    expect(calls[0]?.url).toBe("https://api.test/render?format=md");
    expect(JSON.parse(String(calls[0]!.init.body)).summary.rows).toBe(4);
  });

  it("coverage reads /api/coverage", async () => {
    const { fetch, calls } = mockFetch({ body: { coverage: "C", storage: "S" } });
    expect(await createClient(cfg, fetch).coverage()).toEqual({ coverage: "C", storage: "S" });
    expect(calls[0]?.url).toBe("https://api.test/api/coverage");
    expect(calls[0]?.init.method).toBe("GET");
  });
});

describe("anySignal", () => {
  it("aborts when any input aborts, with that reason, with and without AbortSignal.any", () => {
    const native = AbortSignal.any;
    for (const withNative of [true, false]) {
      if (!withNative) Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true });
      try {
        const a = new AbortController();
        const b = new AbortController();
        const combined = anySignal([a.signal, b.signal]);
        expect(combined.aborted).toBe(false);
        b.abort("because");
        expect(combined.aborted).toBe(true);
        expect(combined.reason).toBe("because");
        const already = new AbortController();
        already.abort("early");
        expect(anySignal([already.signal, new AbortController().signal]).reason).toBe("early");
      } finally {
        Object.defineProperty(AbortSignal, "any", { value: native, configurable: true });
      }
    }
  });
});
