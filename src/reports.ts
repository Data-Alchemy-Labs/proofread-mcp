import { randomBytes } from "node:crypto";
import type { Report } from "./types.js";

/**
 * The last few reports, in this process's memory only, so render_report can be called with a short id
 * instead of the model echoing the whole report JSON. Nothing is written to disk; the map dies with the process.
 */
const MAX_REPORTS = 50;
const reports = new Map<string, Report>();

export function rememberReport(report: Report): string {
  const id = `r_${randomBytes(4).toString("hex")}`;
  reports.set(id, report);
  while (reports.size > MAX_REPORTS) {
    const oldest = reports.keys().next().value;
    if (oldest === undefined) break;
    reports.delete(oldest);
  }
  return id;
}

export function recallReport(id: string): Report | undefined {
  return reports.get(id);
}
