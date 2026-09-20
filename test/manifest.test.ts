import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "../src/server.js";
import { USER_AGENT } from "../src/client.js";
import { tools } from "../src/tools/index.js";

const root = new URL("..", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), "utf8")) as Record<string, any>;

describe("annotations (directory requirement: title plus readOnlyHint or destructiveHint on every tool)", () => {
  const expected: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }> = {
    check_citations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    check_document: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    resolve_citation: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    resolve_citations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    coverage: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    render_report: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    sign_up: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    billing_link: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  };

  it("every tool has a title, a name of 64 characters or fewer, and exactly the expected hints", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(expected).sort());
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.name.length).toBeLessThanOrEqual(64);
      expect(t.annotations, t.name).toEqual(expected[t.name]);
    }
  });
});

describe("manifest.json and server.json stay in step with the server", () => {
  const pkg = read("package.json");
  const manifest = read("manifest.json");
  const registry = read("server.json");

  it("versions agree everywhere", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(registry.version).toBe(pkg.version);
    expect(registry.packages[0].version).toBe(pkg.version);
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(USER_AGENT).toContain(`proofread-mcp/${pkg.version} `);
  });

  it("the manifest lists exactly the server's tools, in order", () => {
    expect(manifest.tools.map((t: { name: string }) => t.name)).toEqual(tools.map((t) => t.name));
    expect(manifest.tools_generated).toBe(false);
  });

  it("the manifest has what the directory requires", () => {
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.name).toBe("proofread-mcp");
    expect(manifest.privacy_policies).toEqual(["https://proofread.law/privacy"]);
    expect(manifest.server).toEqual({ type: "node", entry_point: "dist/cli.js", mcp_config: { command: "node", args: ["${__dirname}/dist/cli.js"], env: { PROOFREAD_API_KEY: "${user_config.api_key}" } } });
    expect(manifest.user_config.api_key).toMatchObject({ type: "string", sensitive: true, required: false });
    expect(manifest.compatibility.runtimes.node).toBe(">=20.0.0");
    expect(manifest.icon).toBe("icon.png");
    expect(pkg.mcpName).toBe(registry.name);
    expect(pkg.files).not.toContain("manifest.json");
  });

  it("README has the Privacy Policy section the directory asks for", () => {
    const readme = readFileSync(new URL("README.md", root), "utf8");
    expect(readme).toMatch(/^## Privacy Policy$/m);
    expect(readme).toContain("https://proofread.law/privacy");
    expect(readme).toContain("privacy@proofread.law");
  });
});
