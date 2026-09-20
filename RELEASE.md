# Releasing proofread-mcp

Owner: Alex (Data Alchemy Labs). Nothing below has been run yet.

## 1. Review

```bash
npm ci && npm run build && npm test
LIVE=1 npm test -- test/live.test.ts
node scripts/smoke-stdio.mjs
git log --oneline
grep -rn "pl_[A-Za-z0-9]\{8\}_" . --exclude-dir=node_modules   # must find nothing (no keys in the tree)
```

## 2. GitHub repository

Public at https://github.com/Data-Alchemy-Labs/proofread-mcp (created 2026-09-20). Push with `git push origin master --tags`;
GitHub has been flaky from this box, so retry a failed push.

CI (`.github/workflows/ci.yml`) builds and tests on Node 20 and 22 and runs the offline stdio smoke. The live test is not run in CI.

## 3. npm

```bash
npm login                      # the Data Alchemy Labs npm account
npm version 0.1.0 --no-git-tag-version   # or the version you want; package.json and src/server.ts SERVER_VERSION must agree
npm publish --access public    # prepublishOnly runs build + test
```

Check: `npx -y proofread-mcp --help` from a clean directory prints the usage.

## 4. Directories and logos

### 4a. MCP Registry (registry.modelcontextprotocol.io)

The registry holds metadata only; the npm package must be published first (step 3). Ownership is proven by `mcpName` in
`package.json`, which must equal `name` in `server.json`; both say `io.github.Data-Alchemy-Labs/proofread-mcp`. The namespace is
granted by GitHub login: `io.github.<login>/*` for the user, and `io.github.<org>/*` only to an org **Owner** (the registry checks
`GET /user/memberships/orgs` with role `admin`; a token needs `read:org`). The check is a case-sensitive prefix match against the
org login as GitHub reports it (`Data-Alchemy-Labs`), so keep that spelling.

```bash
# install the publisher CLI (Linux/macOS)
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
# from the repo root (server.json is committed and validated against the 2025-12-11 schema)
mcp-publisher validate
mcp-publisher login github          # device flow in the browser; log in as an Owner of Data-Alchemy-Labs
mcp-publisher publish
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Data-Alchemy-Labs/proofread-mcp"
```

Each release: bump `version` in `server.json` (top level and `packages[0].version`) together with `package.json`, publish to npm,
then `mcp-publisher publish` again. The registry is in preview; expect breaking changes.

### 4b. Anthropic

- Claude Desktop connector directory needs a `.mcpb` bundle: `npx @anthropic-ai/mcpb init` in a clean checkout, then
  `npx @anthropic-ai/mcpb pack`, and submit at https://claude.com/partners/mcp (the directory intake; Anthropic's review
  requirements are listed there). Nothing is built yet.
- Claude Code and claude.ai users install from npm today (README snippets).

### 4c. OpenAI

- The Agents SDK section in README.md is the integration (Streamable HTTP; `client_session_timeout_seconds=900`).
- For ChatGPT connectors / the Apps SDK the server would need to be hosted with auth in front of it; not in scope for 0.1.x.

### 4d. Others

- Cursor: cursor.directory accepts a PR with the `.cursor/mcp.json` snippet.
- Add the "works with" logos to proofread.law's landing only after the registry entry resolves and the README snippets have been tried once on each client.

## 5. Version bumps

`package.json` `version`, `server.json` (`version` and `packages[0].version`), `src/server.ts` `SERVER_VERSION`, `src/client.ts` `USER_AGENT`. Tag `v<version>` after publishing.
