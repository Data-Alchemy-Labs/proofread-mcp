#!/usr/bin/env node
// Spawns the stdio server and drives it with raw JSON-RPC: initialize, tools/list, then tools/call.
// `--offline` stops after tools/list (no network). Without it, `coverage`, `check_citations`, `resolve_citation` and
// `resolve_citations` hit the live API (PROOFREAD_API, default https://proofread.law).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const offline = process.argv.includes("--offline");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const child = spawn(process.execPath, [join(root, "dist", "cli.js")], { stdio: ["pipe", "pipe", "inherit"], env: process.env });

const pending = new Map();
let nextId = 1;
createInterface({ input: child.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else {
    console.log("<- notification", JSON.stringify(msg));
  }
});

function request(method, params) {
  const id = nextId++;
  const body = { jsonrpc: "2.0", id, method, params };
  console.log(`-> ${method} ${JSON.stringify(params ?? {})}`);
  child.stdin.write(JSON.stringify(body) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`${method}: no answer in 120 s`)), 120_000).unref();
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function show(label, msg) {
  console.log(`<- ${label}`);
  console.log(JSON.stringify(msg, null, 2));
  console.log();
}

const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
show("initialize", init.result ?? init.error);
notify("notifications/initialized", {});

const list = await request("tools/list", {});
const names = (list.result?.tools ?? []).map((t) => t.name);
console.log("<- tools/list:", names.join(", "), "\n");
if (names.length !== 14) {
  console.error("expected 14 tools");
  process.exit(1);
}

let failed = false;
if (!offline) {
  const cov = await request("tools/call", { name: "coverage", arguments: {} });
  show("tools/call coverage", cov.result ?? cov.error);
  failed ||= Boolean(cov.error || cov.result?.isError);

  const text = "Title VII forbids discrimination because of sexual orientation. Bostock v. Clayton County, 509 U.S. 644 (2020).";
  const check = await request("tools/call", { name: "check_citations", arguments: { text } });
  show("tools/call check_citations", check.result ?? check.error);
  failed ||= Boolean(check.error || check.result?.isError);

  const one = await request("tools/call", { name: "resolve_citation", arguments: { citation: "Bostock v. Clayton County, 590 U.S. 644 (2020)" } });
  show("tools/call resolve_citation", one.result ?? one.error);
  failed ||= Boolean(one.error || one.result?.isError);

  const many = await request("tools/call", { name: "resolve_citations", arguments: { cites: ["590 U.S. 644", "509 U.S. 644", "1 F.4th 99999", "999 U.S. 1", "2023 WL 4567890"] } });
  show("tools/call resolve_citations", many.result ?? many.error);
  failed ||= Boolean(many.error || many.result?.isError);
}

child.stdin.end();
child.kill();
process.exit(failed ? 1 : 0);
