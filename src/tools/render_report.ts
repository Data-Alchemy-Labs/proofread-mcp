import { z } from "zod";
import { recallReport } from "../reports.js";
import type { Report } from "../types.js";
import { defineTool, fail, ok } from "./tool.js";

export const renderReport = defineTool({
  name: "render_report",
  title: "Render a check as a markdown report",
  description:
    "Turn a finished check into a markdown diligence report: header, coverage and storage notices, a summary table sorted check-this, cannot-verify, support, found, " +
    "and a detail block per flagged row with the register evidence. Use it when the user wants a report to keep or attach to the file, or when the compact result was cut short. " +
    "Pass the report_id returned by check_citations or check_document (ids live in this server's memory until it exits), or the full report JSON from proofread.law's /verify endpoint. Free, not counted.",
  inputSchema: {
    report_id: z.string().regex(/^r_[0-9a-f]{8}$/).optional().describe("The 'Report id' from a previous check_citations or check_document result."),
    report: z.record(z.string(), z.unknown()).optional().describe("A full report JSON as returned by POST /verify, if you have one instead of an id."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run({ report_id, report }, { client }, extra) {
    let source: Report | undefined;
    if (report_id) {
      source = recallReport(report_id);
      if (!source) return fail(`no report ${report_id} in memory (this server keeps the last 50 checks until it exits). Run the check again and use the new id.`);
    } else if (report && isReport(report)) {
      source = report;
    } else {
      return fail("give either report_id (from a previous check) or report (the full JSON from /verify with summary, rows, coverage and storage).");
    }
    try {
      return ok(await client.renderMarkdown(source, extra.signal));
    } catch (err) {
      return fail(err);
    }
  },
});

function isReport(value: Record<string, unknown>): value is Report {
  return Array.isArray(value.rows) && typeof value.summary === "object" && value.summary !== null && typeof value.coverage === "string";
}
