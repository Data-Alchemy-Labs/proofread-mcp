# proofread-mcp

An MCP server for [proofread.law](https://proofread.law). It lets Claude Desktop, Claude Code, Cursor and the OpenAI Agents SDK check US case citations before a draft is filed.

proofread.law checks each citation against an open register of about 10 million court opinions (CourtListener bulk data). Every result says what was checked, what was found, and what the register cannot see.

## What it does

Eight tools:

| Tool | Input | What comes back |
|---|---|---|
| `check_citations` | text, `deep` (optional) | The coverage statement, counts per tier, one line per row that needs a human (red first, then orange, then deep-check rows to review), the number of citations found, a report id |
| `check_document` | path to a `.pdf`, `.docx`, `.txt` or `.md` (up to 10 MB), `deep` (optional) | The same, for a file on disk |
| `resolve_citation` | one citation string | The register's answer for that citation: found (case, court, date, parallel citations, link), ambiguous (candidates), not in the register, cannot verify, known citation, or no citation recognised; the coverage of that volume; the coverage statement |
| `resolve_citations` | a list of up to 500 citation strings | Counts by status, one line per citation in input order, the coverage statement |
| `coverage` | nothing | The coverage statement and the storage notice |
| `render_report` | a report id from a previous check, or the full report JSON | A markdown diligence report with every row |
| `sign_up` | the account owner's email, a name for the agent | A proofread.law account and an API key (shown once); the server uses it for the rest of the session |
| `billing_link` | `payg`, `solo` or `firm` | A Stripe Checkout link for the account owner; needs an API key |

The compact result of a check is capped at about 12,000 characters; when a long brief has more flagged rows than fit, the text says how many were left out and `render_report` has them all.

`check_citations` and `check_document` read prose: they compare the case name and any quotation with the register. `resolve_citation` and `resolve_citations` look the citation string up in the register (the `/v1/resolve` API) and tell you which case sits there; they do not compare it with the name you have.

Tiers, in the words the tools use:

| Tier | Word | Meaning |
|---|---|---|
| red | check this | The register holds something concrete that disagrees: a different case at that citation, a volume or page that does not match, quoted words not in the opinion |
| orange | cannot verify | Nothing to check against: a Westlaw or Lexis identifier, a volume newer than the register, a reporter the register holds only in part. Not evidence either way |
| green | found | The citation resolves to a case whose caption matches |
| white | deep check | With `deep: true` only: whether the opinion supports the sentence it is cited for. A review queue, not a verdict |

What it cannot do: resolve Westlaw (WL) or Lexis identifiers, check statutes, regulations or secondary sources, or say whether a case is still good law. Those limits are stated in every tool description and in the coverage statement that comes with every result.

## Install

Needs Node 20 or newer. No install step is required; `npx` fetches [proofread-mcp from npm](https://www.npmjs.com/package/proofread-mcp).

### Claude Desktop (extension bundle)

Download `proofread-mcp-<version>.mcpb` from the [latest GitHub release](https://github.com/Data-Alchemy-Labs/proofread-mcp/releases/latest) and open it with Claude Desktop (double-click, or Settings, Extensions, Install Extension). The bundle carries the server and its dependencies and uses the Node runtime that ships with Claude Desktop, so nothing else has to be installed. The only setting is the optional API key, stored by Claude Desktop as a sensitive value and passed to the server as `PROOFREAD_API_KEY`.

To build the bundle yourself: `scripts/build-mcpb.sh` (needs `npx @anthropic-ai/mcpb`) writes `build/proofread-mcp-<version>.mcpb` from `manifest.json`, `icon.png` and the npm package contents.

### Claude Desktop (config file)

Edit `claude_desktop_config.json` (Settings, Developer, Edit Config):

```json
{
  "mcpServers": {
    "proofread": {
      "command": "npx",
      "args": ["-y", "proofread-mcp"],
      "env": {
        "PROOFREAD_API_KEY": "pl_..."
      }
    }
  }
}
```

Leave out `env` to use the free tier.

### Claude Code

```bash
claude mcp add proofread -- npx -y proofread-mcp
# with an API key:
claude mcp add proofread -e PROOFREAD_API_KEY=pl_... -- npx -y proofread-mcp
```

### Cursor

Settings, MCP, Add new global MCP server, or write `.cursor/mcp.json` in the project:

```json
{
  "mcpServers": {
    "proofread": {
      "command": "npx",
      "args": ["-y", "proofread-mcp"],
      "env": { "PROOFREAD_API_KEY": "pl_..." }
    }
  }
}
```

### OpenAI Agents SDK (over HTTP)

Start the server with the HTTP transport:

```bash
PROOFREAD_API_KEY=pl_... npx proofread-mcp --http --port 3333
# MCP endpoint: http://127.0.0.1:3333/mcp   health: http://127.0.0.1:3333/health
```

Then connect from the Agents SDK:

```python
from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

# The SDK's default read timeout is 5 s. A check of a long brief takes up to 6 s and a deep check 1 to 2 s per citation,
# so give the session up to 15 minutes (the API's own deep-check limit).
async with MCPServerStreamableHttp(params={"url": "http://127.0.0.1:3333/mcp"}, client_session_timeout_seconds=900) as proofread:
    agent = Agent(name="Drafting assistant", instructions="Check every case citation before you rely on it.", mcp_servers=[proofread])
    result = await Runner.run(agent, "Check the citations in this paragraph: ...")
```

```ts
import { Agent, run, MCPServerStreamableHttp } from "@openai/agents";

const proofread = new MCPServerStreamableHttp({ url: "http://127.0.0.1:3333/mcp", name: "proofread" });
await proofread.connect();
try {
  const agent = new Agent({ name: "Drafting assistant", mcpServers: [proofread] });
  const result = await run(agent, "Check the citations in this paragraph: ...");
} finally {
  await proofread.close();
}
```

The HTTP server binds to 127.0.0.1 by default and is single-tenant by design: it has no authentication of its own, report ids are shared across sessions, and a key from `sign_up` is adopted by the whole process. Sessions that stay idle for 30 minutes are closed. To expose it on a network use `--host 0.0.0.0` and put it behind something that adds authentication.

### Any MCP client

stdio: run `proofread-mcp`. Streamable HTTP: run `proofread-mcp --http --port 3333` and point the client at `/mcp`.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PROOFREAD_API_KEY` | unset | An API key (`pl_...`), sent as `Authorization: Bearer` to `PROOFREAD_API` only. Every plan has keys (free 1, pay as you go 3, solo 3, firm 5); a paid-plan key lifts the free-tier limits. Without it the free tier applies per IP |
| `PROOFREAD_API` | `https://proofread.law` | Base URL, for a self-hosted or test instance |

## Accounts and keys

An agent can open an account itself: `sign_up` posts the owner's real email and a name to `POST /agent/signup` and gets a key back, shown once. The server uses that key for the rest of the session; put it in `PROOFREAD_API_KEY` to keep it. The owner receives one confirmation email. When a quota is used up (a tool answers "needs the ... plan" or "monthly allowance used"), `billing_link` returns a Stripe Checkout link for the owner; nothing is charged until they pay. Plans and prices: [proofread.law/pricing](https://proofread.law/pricing). The onboarding text the API publishes for agents is at [proofread.law/agent/onboarding.md](https://proofread.law/agent/onboarding.md).

## Free tier

Per month, per IP address without a key or per account with a free-tier key:

| Tools | Quota |
|---|---|
| `check_citations`, `check_document` | 20 checks, of which 3 may be deep checks |
| `resolve_citation`, `resolve_citations` | 1,000 resolves (each citation in a list counts as one) |
| `coverage`, `render_report`, `sign_up`, `billing_link` | free, not counted |

There is also a limit of 20 requests an hour per IP (more on paid plans). When a limit is reached the tool returns a plain message with the retry time or the upgrade link; nothing is thrown at the protocol level.

`.docx` upload and unlimited checks need a paid plan. See [proofread.law/pricing](https://proofread.law/pricing).

## Privacy Policy

The full policy is at [proofread.law/privacy](https://proofread.law/privacy). What applies to this server:

- **What is collected.** The text or file you check leaves your machine and goes to proofread.law's own server (`PROOFREAD_API`, default `https://proofread.law`), over HTTPS, in the request that checks it. `sign_up` sends the account owner's email address and the agent name you give it. Nothing else is sent: no conversation history, no other files, no telemetry.
- **Use and storage on proofread.law.** The input is processed in memory and discarded when the report is returned; no copy is written to disk. The log line per request carries the kind of input, its size, the number of citations, the tier counts and the time taken, never a citation, a party name or a word of text. With an account, proofread.law keeps the email address, the plan, a monthly count of checks and a hash of each API key.
- **Third parties.** A citation string the register cannot resolve may be looked up in CourtListener's citation API (the citation string only, never prose). Deep check (`deep: true`) is opt-in: the clause before each citation (up to 700 characters) and the cited opinion go to the model judge; that is the only mode in which words from your document leave proofread.law. Sign-in links go through Resend; payments through Stripe, which sees the card and proofread.law does not. Requests pass through Cloudflare's edge in transit.
- **Retention.** Inputs and reports: none. Account records: until the owner asks for deletion at privacy@proofread.law.
- **This server.** It stores nothing on disk. It keeps the last 50 reports in memory so `render_report` can be called with a short id; they are gone when the process exits. The API key lives in your MCP client's configuration (Claude Desktop stores the extension's key as a sensitive setting); a key from `sign_up` is held in memory for the session and shown to you once so you can store it. It is sent only to `PROOFREAD_API`, as an `Authorization: Bearer` header. If a deep-check stream stops before every citation was judged, the tool answers with an error that says how many were checked; it never presents a partial deep check as a finished one.
- **Contact.** Data Alchemy Labs, privacy@proofread.law.

## The coverage caveat

Every result starts with the coverage statement, for example:

> Checked against 10.1 M cases (CourtListener bulk data 2026-06-30, last refreshed 2026-09-19); federal appellate 2019 to 2023 is 10 to 15% incomplete; Westlaw/Lexis identifiers are not resolvable; statutes, regulations and secondary sources are not checked.

Read it. A citation that is not in the register is a register fact with a coverage qualifier, not proof that the case does not exist. A red row says "check this"; the tools say what was checked and what was found, never that a case is invented.

## Example

Input:

> Title VII forbids discrimination because of sexual orientation. Bostock v. Clayton County, 509 U.S. 644 (2020).

`check_citations` returns (real output, review instance, 2026-09-20):

```
Coverage: Checked against 10.1 M cases (CourtListener bulk data 2026-06-30, last refreshed 2026-09-19); federal appellate 2019 to 2023 is 10 to 15% incomplete; Westlaw/Lexis identifiers are not resolvable; statutes, regulations and secondary sources are not checked.
Summary: 1 citation, 1 row. Check this (red): 1. Cannot verify (orange): 0. Found (green): 0.
Flagged rows:
- CHECK THIS: 509 U.S. 644 (Bostock v. Clayton County). Register has Bostock v. Clayton County at 590 U.S. 644. Check the volume. In the register, 509 U.S. 644 is Shaw v. Reno. The case named in the document exists; this citation does not point to it. Register: https://www.courtlistener.com/opinion/4760997/bostock-v-clayton-county/
Found: 0 rows resolved to a case in the register.
Report id: r_1ff74051 (give it to render_report for a markdown report). Elapsed: 0.03 s.
Storage: Nothing you submit is stored. The document is processed in memory and discarded when this report is returned; only counts (citations, tiers, timing) are logged, never text.
```

## Development

```bash
npm install
npm run build          # tsc -> dist/
npm test               # vitest, mocked fetch, no network
LIVE=1 npm test -- test/live.test.ts   # three live calls against proofread.law (counts against the free tier)
node scripts/smoke-stdio.mjs           # spawn the stdio server, initialize, tools/list, four live tool calls
node scripts/smoke-stdio.mjs --offline # the same without network
```

Layout: `src/client.ts` is the typed HTTP client (`/verify`, `/render`, `/api/coverage`, `/v1/resolve` single and batch), `src/format.ts` the compact formatter for checks, `src/resolve_format.ts` the one for register answers, `src/tools/<name>.ts` one file per tool, `src/server.ts` registers them, `src/cli.ts` picks the transport. The remaining register routes (`/v1/extract`, `/v1/case/{id}`, `/v1/coverage` per reporter) slot in the same way: one method on the client, one file under `src/tools/`.

## Publishing

See [RELEASE.md](RELEASE.md): npm, the MCP Registry (`server.json` is in the repository), the Claude Desktop extension bundle (`manifest.json`, `scripts/build-mcpb.sh`, attached to each GitHub release) and Anthropic's connector directory.

## License

MIT, Data Alchemy Labs.
