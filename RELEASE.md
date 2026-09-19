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

## 2. GitHub repository (private first, public after review)

```bash
gh repo create Data-Alchemy-Labs/proofread-mcp --private --source . --push
# later, when ready:
gh repo edit Data-Alchemy-Labs/proofread-mcp --visibility public --accept-visibility-change-consequences
```

CI (`.github/workflows/ci.yml`) builds and tests on Node 20 and 22 and runs the offline stdio smoke. The live test is not run in CI.

## 3. npm

```bash
npm login                      # the Data Alchemy Labs npm account
npm version 0.1.0 --no-git-tag-version   # or the version you want; package.json and src/server.ts SERVER_VERSION must agree
npm publish --access public    # prepublishOnly runs build + test
```

Check: `npx -y proofread-mcp --help` from a clean directory prints the usage.

## 4. Directories and logos

- Anthropic: submit to the MCP servers list (github.com/modelcontextprotocol/servers, "Community servers") and to the Claude Desktop extensions directory once a `.mcpb` bundle is built (`npx @anthropic-ai/mcpb pack`).
- OpenAI: the Agents SDK section in README.md is the integration; register the HTTP endpoint with any OpenAI-facing listing when one is opened.
- Cursor: cursor.directory accepts a PR with the `.cursor/mcp.json` snippet.
- Add the "works with" logos to proofread.law's landing only after the npm package resolves and the README snippets have been tried once on each client.

## 5. Version bumps

`package.json` `version`, `src/server.ts` `SERVER_VERSION`, `src/client.ts` `USER_AGENT`. Tag `v<version>` after publishing.
