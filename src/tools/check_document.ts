import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "../client.js";
import { formatReport } from "../format.js";
import { rememberReport } from "../reports.js";
import { verifyOptions } from "./check_citations.js";
import { DEEP_NOTE, LIMITS_NOTE, defineTool, fail, ok } from "./tool.js";

const ALLOWED = new Set([".pdf", ".docx", ".txt", ".md"]);

export const checkDocument = defineTool({
  name: "check_document",
  title: "Check legal citations in a file",
  description:
    "Check every case citation in a document on disk (PDF, DOCX or TXT, up to 10 MB) against proofread.law's register of about 10 million US court opinions. " +
    "The file is read here and uploaded to proofread.law, which extracts the text in memory, checks it and discards it. " +
    "Returns the same compact result as check_citations: coverage statement, counts per tier, one line per red (check this) or orange (cannot verify) row, " +
    "the number of citations found, and a report id for render_report. " +
    "Scanned PDFs without a text layer, encrypted PDFs and legacy .doc files cannot be read; .docx needs a paid plan. " +
    LIMITS_NOTE + " " + DEEP_NOTE,
  inputSchema: {
    path: z.string().min(1).describe("Absolute path to a .pdf, .docx or .txt file on this machine."),
    deep: z.boolean().optional().describe("Also check whether each cited opinion supports the sentence it is cited for. Slower, opt-in, 3 per month on the free tier."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ path, deep }, { client }, extra) {
    const ext = extname(path).toLowerCase();
    if (!ALLOWED.has(ext)) {
      return fail(new Error(`${path}: only .pdf, .docx, .txt and .md files can be checked`));
    }
    let bytes: Uint8Array;
    try {
      const info = await stat(path);
      if (!info.isFile()) return fail(new Error(`${path} is not a file`));
      if (info.size > MAX_UPLOAD_BYTES) return fail(new Error(`${path} is ${info.size} bytes; the cap is 10 MB`));
      bytes = await readFile(path);
    } catch (err) {
      return fail(new Error(`could not read ${path}: ${err instanceof Error ? err.message : String(err)}`));
    }
    try {
      const report = await client.verifyFile(bytes, basename(path), verifyOptions(deep, extra));
      return ok(formatReport(report, rememberReport(report)), { summary: report.summary, coverage: report.coverage, input: report.input ?? null });
    } catch (err) {
      return fail(err);
    }
  },
});
