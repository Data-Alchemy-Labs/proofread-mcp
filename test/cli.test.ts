import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";
import { configFromEnv } from "../src/config.js";

describe("parseArgs", () => {
  it("defaults to stdio", () => expect(parseArgs([])).toEqual({ http: false, port: 3333, host: "127.0.0.1", help: false }));
  it("reads --http --port N --host H in both spellings", () => {
    expect(parseArgs(["--http", "--port", "4000"])).toMatchObject({ http: true, port: 4000 });
    expect(parseArgs(["--http", "--port=4001", "--host=0.0.0.0"])).toMatchObject({ http: true, port: 4001, host: "0.0.0.0" });
  });
  it("rejects unknown flags and bad ports", () => {
    expect(() => parseArgs(["--sse"])).toThrow(/unknown argument --sse/);
    expect(() => parseArgs(["--port", "70000"])).toThrow(/--port/);
  });
});

describe("configFromEnv", () => {
  it("uses the defaults", () => expect(configFromEnv({})).toEqual({ baseUrl: "https://proofread.law" }));
  it("trims a trailing slash and picks up the key", () => {
    expect(configFromEnv({ PROOFREAD_API: "http://127.0.0.1:8008/", PROOFREAD_API_KEY: " pl_a_b " })).toEqual({ baseUrl: "http://127.0.0.1:8008", apiKey: "pl_a_b" });
  });
  it("an empty key means no key", () => expect(configFromEnv({ PROOFREAD_API_KEY: "" })).toEqual({ baseUrl: "https://proofread.law" }));
});
