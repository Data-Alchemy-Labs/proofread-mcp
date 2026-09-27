# proofread-mcp

An MCP server for [proofread.law](https://proofread.law). It lets Claude Desktop, Claude Code, Cursor and the OpenAI Agents SDK check case citations before a draft is filed: about 10 million US court opinions, and 1.1 million Swiss decisions (BGE/ATF/DTF, Federal Supreme Court dockets, the federal courts and all 26 cantons). The jurisdiction is detected from the draft, and a Swiss report comes back in the draft's language: German, French or Italian.

proofread.law checks each citation against an open register of about 10 million court opinions (CourtListener bulk data). Every result says what was checked, what was found, and what the register cannot see.

## What it does

Fourteen tools:

| Tool | Input | What comes back |
|---|---|---|
| `check_citations` | text, `deep` (optional) | The coverage statement, counts per tier, one line per row that needs a human (red first, then orange, then deep-check rows to review), the number of citations found, a report id |
| `check_document` | path to a `.pdf`, `.docx`, `.txt` or `.md` (up to 10 MB), `deep` (optional) | The same, for a file on disk |
| `resolve_citation` | one citation string | The register's answer for that citation: found (case, court, date, parallel citations, link), ambiguous (candidates), not in the register, cannot verify, known citation, or no citation recognised; the coverage of that volume; the coverage statement |
| `resolve_citations` | a list of up to 500 citation strings | Counts by status, one line per citation in input order, the coverage statement |
| `coverage` | `jurisdiction` (optional: `us` or `ch`) | The coverage statement and the storage notice; `ch` gives the Swiss register with the courts held and the share of the live index each covers |
| `render_report` | a report id from a previous check, or the full report JSON | A markdown diligence report with every row |
| `suggest_cases` | a Swiss federal statute article or a paragraph that cites one, or a sentence of US law; `court`, `jurisdiction`, `domain`, `lang`, `k` (each optional) | Swiss: the leading Federal Supreme Court cases (BGE) cited with the article, to read, in one ranked list, each labelled with its field of law and given with the quoted passage, any later change of practice, the decision's link and a link to check the citation; in the query's language. US (beta): up to 3 cases whose own text states the sentence, each with the passage the model matched, the paragraphs around it, how it binds the court you name, the opinion's link and a link to check the citation |
| `save_brief` | text, `title` (optional) | Saves the brief to the user's account (opt-in, stored encrypted) and checks it: the brief id, then the same compact result as `check_citations` |
| `list_briefs` | none | The saved briefs: id, title, when saved and last checked, counts per tier, number of versions |
| `get_brief` | id, `include_text` (default true), `version` (optional) | The saved text, the latest report and the versions kept; with `version`, that earlier text |
| `update_brief` | id, `text`, `title`, `recheck` (each optional, at least one) | Saves the edited text as a new version and re-checks it: the flags resolved since the previous version, the new flags (each with its headline), the unchanged count, then every row that still needs attention. `recheck: true` re-runs the check on the saved text without editing it, e.g. after the register was updated. A title alone renames without a check |
| `delete_brief` | id | Permanently deletes the brief and its versions |
| `sign_up` | the account owner's email, a name for the agent | A proofread.law account and an API key (shown once); the server uses it for the rest of the session |
| `billing_link` | `payg`, `solo` or `firm` | A Stripe Checkout link for the account owner; needs an API key |

The compact result of a check is capped at about 12,000 characters; when a long brief has more flagged rows than fit, the text says how many were left out and `render_report` has them all.

### Saved briefs (opt-in)

Nothing is saved unless `save_brief` or `update_brief` is called; `check_citations` and `check_document` never save anything. A saved brief is stored encrypted in the user's proofread.law account until `delete_brief` removes it, so the brief tools need an API key (any `PROOFREAD_API_KEY`, or one from `sign_up`); without one they answer with a message and send nothing. A server with storage switched off answers `storage_off`, and the tools say so.

The loop for fixing flagged citations: `save_brief` once, fix a flagged row in the text (the citation, the case name, the quotation, or take the citation out), call `update_brief` with the id and the whole edited text, and read what changed: which flags were resolved (flagged before, not flagged now), which are new, and the rows that still need attention. The last 20 versions are kept; `get_brief` lists them and reads an earlier one. Ids are integers in the API and strings in the tools.

`check_citations` and `check_document` read prose: they compare the case name and any quotation with the register. `resolve_citation` and `resolve_citations` look the citation string up in the register (the `/v1/resolve` API) and tell you which case sits there; they do not compare it with the name you have.

Tiers, in the words the tools use:

| Tier | Word | Meaning |
|---|---|---|
| red | check this | The register holds something concrete that disagrees: a different case at that citation, a volume or page that does not match, quoted words not in the opinion |
| orange | cannot verify | Nothing to check against: a Westlaw or Lexis identifier, a volume newer than the register, a reporter the register holds only in part. Not evidence either way |
| green | found | The citation resolves to a case whose caption matches |
| white | deep check | With `deep: true` only: whether the opinion supports the sentence it is cited for. A review queue, not a verdict |

What it cannot do: resolve Westlaw (WL) or Lexis identifiers, check statutes, regulations or secondary sources, or say whether a case is still good law. Those limits are stated in every tool description and in the coverage statement that comes with every result.

### Case suggestions (Switzerland)

`suggest_cases` takes a Swiss federal statute article (`Art. 41 OR`, `art. 41 CO`, `Art. 8 ZGB`, `art. 9 Cst.`; lowercase and dotless forms such as `art 41 or` are read too) or a paragraph that cites articles, and lists the leading Federal Supreme Court cases (BGE) the court cites with it. Federal acts only; cantonal law is not covered. There is no free-text search: a query without an article answers with a message that no article was recognised. The answer is one ranked list in the measured order, each case labelled with its field of law; the `domain` filter keeps the same order within one field, so a filtered row keeps its overall rank (`Rang 7`, `Rang 9`, ...) and a filter note says which field is shown. Each row has the citation, date, field, the decision's language, its rank, the quoted passage (regeste or consideration), any later change of practice (a changed precedent is listed with its flag, never dropped), the decision at the court's site and a link that opens the check on proofread.law. Every string comes back in the query's language (German, French or Italian; `lang: "en"` for English), and the tool prints it as it is. A suggestion is a case to read: it has not been checked against your sentence, and a row without a flag is not evidence that its practice still holds. To check a citation, use `check_citations`.

Arguments: `query` (required, up to 20,000 characters; over 1,500 it is sent as POST), `domain` (`all`, `civil`, `criminal`, `public` or `social`; default `all`), `lang` (`de`, `fr`, `it` or `en`; default the query's language), `k` (number of rows, 1 to 50; default 10). With a large `k`, rows past about 20,000 characters of text keep their header line and any practice flag and leave out the passage and links, which stay in the structured result (with the counts per field). During the trial phase it needs a paid-plan or trial API key; otherwise the API answers `plan_required` and the tool says where to upgrade.

Example call, `suggest_cases` with `{"query": "Art. 41 OR, Art. 97 OR", "k": 3}` (dev instance, 2026-09-26; rows 2 and 3 cut):

```
Gelesen als: Art. 41 OR, Art. 97 OR
1. BGE 146 IV 76, 13.11.2019, Strafrecht, FR, Rang 1
   Das Bundesgericht zitiert diesen Entscheid zusammen mit Art. 41 OR; der Entscheid selbst nennt den Artikel nicht. Aus der Regeste: «a) Art. 110 Abs. 1 StGB; Art. 118, 121 Abs. 1 und 382 Abs. 1 StPO; ...»
   Entscheid öffnen: https://search.bger.ch/ext/eurospider/live/de/php/clir/http/index.php?highlight_docid=atf%3A%2F%2F146-IV-76%3Ade&lang=de&type=show_document
   Zitat prüfen: https://proofread.law/?cite=Art.%2041%20OR%3B%20BGE%20146%20IV%2076#check
...
Die Vorschläge sind publizierte Leitentscheide (BGE). Sie sind danach gereiht, wie oft das Bundesgericht sie zusammen mit dem Artikel zitiert, [...] Ein Vorschlag ist ein Entscheid zum Lesen: Ob er Ihre Aussage stützt, prüft diese Liste nicht, und ein Entscheid ohne Hinweis ist kein Beleg dafür, dass seine Praxis weiter gilt.
```

With `"domain": "civil"` the list starts with the filter note and keeps the overall ranks:

```
Gelesen als: Art. 41 OR
Filter: Zivilrecht. Die Reihenfolge ist dieselbe wie in der ganzen Liste.
1. BGE 132 III 122, 13.09.2005, Zivilrecht, FR, Rang 7
   Regeste: «Rechtmässigkeit von im Arbeitskampf eingesetzten Mitteln (Art. 28 BV; Art. 41 und 357a OR). ...»
   ...
```

A filter that leaves no rows answers with a message saying so. A later change of practice appears right under the row it concerns, for example `Praxisänderung durch BGE 145 III 1, möglicherweise nur teilweise: <link>` followed by the regeste sentence that marks it.

### Case suggestions (United States, beta)

`suggest_cases` also takes a sentence from a US draft that states a rule of law (one sentence, or a short paragraph up to 1,500 characters) and lists up to 3 cases whose own text states it. A model reads the opinion of the court in each of the top 10 candidates, and a case is shown only when the model finds a passage in it that states the sentence. Each row has the reference, the court, the year, how the case stands to the court you name (binding here, same circuit, persuasive), any later history the citator found (reversed in part, superseded by statute), the passage the model matched with the paragraphs before and after it (each cut to about 600 characters), a link to the opinion on CourtListener and a link that opens the check on proofread.law. Cases that a later court overruled or reversed are left out, and a note names them.

This is a beta. Every answer starts with a line that says so, with the measured numbers: of 73 cases shown for 50 sentences from filed briefs, 59 (81%) support the sentence and 1 does not, as read blind by two model readers, not practising lawyers ([details](https://proofread.law/measurements#suggestions)). Read the passage before you cite the case. A suggestion is a case to read; to check a citation, use `check_citations`.

Arguments: `court` (optional, up to 200 characters) is the court the brief is filed in: a federal court of appeals (`9th Cir.`, `Ninth Circuit`, `ca9`), a district court (`N.D. Cal.`, `S.D.N.Y.`, `cand`), or a state or territory name or postal code (`California`, `CA`) for the federal court there. Cases that bind that court come first; without a court, Supreme Court cases come first. State courts are not read yet; a court the API does not read comes back as an error that says what it reads. `jurisdiction` is `auto` by default: a Swiss statute article, or German, French or Italian text, is Swiss, and anything else is a US sentence; `us` or `ch` sets it. `domain`, `lang` and `k` apply to Swiss answers only, and a US answer is in English.

Input that states no rule of law (a question, a citation or case name, a heading, a statement about the record or a party's argument, or more than 1,500 characters) gets no list. The answer says what to paste instead and gives an example sentence, and it costs nothing. A US answer that ran the model counts as one deep-checked citation, not a resolve. When the day's budget for model calls is spent, US suggestions are back the next day (UTC).

Example call, `suggest_cases` with a sentence on the plausibility pleading standard and `"court": "N.D. Cal."` (dev instance, 2026-09-26; the passage and the paragraphs around it shortened, rows 2 and 3 cut):

```
Beta: Each case is shown with the passage we matched; read it before you cite the case. Measured: 81% of shown cases support the sentence, 1 in 73 did not (details on https://proofread.law/measurements#suggestions).
Ordered for N.D. Cal. (Ninth Circuit): binding cases first.
1. Bell Atlantic Corp. v. Twombly, 550 U.S. 544 (2007), Supreme Court, 2007, Binding here (Supreme Court)
   The passage we matched: "Here, in contrast, we do not require heightened fact pleading of specifics, but only enough facts to state a claim to relief that is plausible on its face. Because the plaintiffs here have not nudged ..."
   Before: "Plaintiffs say that our analysis runs counter to Swierkiewicz, 534 U. S., at 508 , which held that “a complaint in an employment discrimination lawsuit [need] n..."
   After: "The judgment of the Court of Appeals for the Second Circuit is reversed, and the case is remanded for further proceedings consistent with this opinion...."
   Read the opinion: https://www.courtlistener.com/opinion/145730/bell-atlantic-corp-v-twombly/
   Check this citation: https://proofread.law/?cite=Bell%20Atlantic%20Corp.%20v.%20Twombly%2C%20550%20U.S.%20544%20%282007%29#check
2. Ashcroft v. Iqbal, 556 U.S. 662 (2009), Supreme Court, 2009, Binding here (Supreme Court)
...
3. Greg Landers v. Quality Communications, Inc., 771 F.3d 638 (9th Cir. 2014), Court of Appeals for the Ninth Circuit, 2014, Binding here
...
How we build this list: we search the sentences in which federal appellate courts and the Supreme Court cite a case, and the cases' own text. [...] We leave out cases that a later court overruled or reversed.
```

A question gets the beta line, then the API's message and an example:

```
This reads as a question. Paste the rule itself, as a sentence, and we will look for cases that state it.
For example: "A complaint must contain sufficient factual matter, accepted as true, to state a claim to relief that is plausible on its face."
```

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
| `save_brief`, `update_brief` with new text or `recheck` | each runs a default check and counts as one of those checks; a title alone is not counted. Each plan has a cap on saved briefs |
| `resolve_citation`, `resolve_citations` | 1,000 resolves (each citation in a list counts as one) |
| `suggest_cases` | paid plans and trials only during the trial phase; a Swiss answer counts as one resolve (a query without an article costs nothing); a US answer that ran the model counts as one deep-checked citation (input that states no rule of law costs nothing) |
| `coverage`, `render_report`, `sign_up`, `billing_link` | free, not counted |

There is also a limit of 20 requests an hour per IP (more on paid plans). When a limit is reached the tool returns a plain message with the retry time or the upgrade link; nothing is thrown at the protocol level.

`.docx` upload and unlimited checks need a paid plan. See [proofread.law/pricing](https://proofread.law/pricing).

## Privacy Policy

The full policy is at [proofread.law/privacy](https://proofread.law/privacy). What applies to this server:

- **What is collected.** The text or file you check leaves your machine and goes to proofread.law's own server (`PROOFREAD_API`, default `https://proofread.law`), over HTTPS, in the request that checks it. `save_brief` and `update_brief` send the brief's text and title the same way; `suggest_cases` sends the query (an article, a sentence, or the paragraph you give it) and the court, if you name one. `sign_up` sends the account owner's email address and the agent name you give it. Nothing else is sent: no conversation history, no other files, no telemetry.
- **Use and storage on proofread.law.** A checked input is processed in memory and discarded when the report is returned; no copy is written to disk. The exception is opt-in: a brief saved with `save_brief` or `update_brief` is stored encrypted in the user's account, with its reports and earlier versions, until `delete_brief` deletes it (permanently). No other tool saves anything. The log line per request carries the kind of input, its size, the number of citations, the tier counts and the time taken, never a citation, a party name or a word of text. With an account, proofread.law keeps the email address, the plan, a monthly count of checks and a hash of each API key.
- **Third parties.** A citation string the register cannot resolve may be looked up in CourtListener's citation API (the citation string only, never prose). Deep check (`deep: true`) is opt-in: the clause before each citation (up to 700 characters) and the cited opinion go to the model judge. A US `suggest_cases` query (the beta) goes to the same model judge, with the opinions of the candidate cases. Those two are the only cases in which words you send leave proofread.law. Sign-in links go through Resend; payments through Stripe, which sees the card and proofread.law does not. Requests pass through Cloudflare's edge in transit.
- **Retention.** Inputs and reports: none, except saved briefs, which are kept until the user deletes them. Account records: until the owner asks for deletion at privacy@proofread.law.
- **This server.** It stores nothing on disk, saved briefs included (they live in the proofread.law account, not here). It keeps the last 50 reports in memory so `render_report` can be called with a short id; they are gone when the process exits. The API key lives in your MCP client's configuration (Claude Desktop stores the extension's key as a sensitive setting); a key from `sign_up` is held in memory for the session and shown to you once so you can store it. It is sent only to `PROOFREAD_API`, as an `Authorization: Bearer` header. If a deep-check stream stops before every citation was judged, the tool answers with an error that says how many were checked; it never presents a partial deep check as a finished one.
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

Layout: `src/client.ts` is the typed HTTP client (`/verify`, `/render`, `/api/coverage`, `/v1/resolve` single and batch, `/v1/briefs`, `/v1/suggest`), `src/format.ts` the compact formatter for checks, `src/resolve_format.ts` the one for register answers, `src/briefs_format.ts` the one for saved briefs (`/v1/briefs`), `src/suggest_format.ts` the one for case suggestions (`/v1/suggest`), `src/tools/<name>.ts` one file per tool, `src/server.ts` registers them, `src/cli.ts` picks the transport. The remaining register routes (`/v1/extract`, `/v1/case/{id}`, `/v1/coverage` per reporter) slot in the same way: one method on the client, one file under `src/tools/`.

## Publishing

See [RELEASE.md](RELEASE.md): npm, the MCP Registry (`server.json` is in the repository), the Claude Desktop extension bundle (`manifest.json`, `scripts/build-mcpb.sh`, attached to each GitHub release) and Anthropic's connector directory.

## License

MIT, Data Alchemy Labs.
