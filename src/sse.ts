import { ProofreadError } from "./errors.js";
import type { Report, Row, Summary } from "./types.js";

/**
 * Reads a `POST /verify?deep=1` Server-Sent Events body into one report.
 * Events: `report` (the full report, rows provisional), `row` (one row with `support` filled), `done` ({summary, elapsed_s}).
 * Comment lines (`: keepalive`) are skipped. `onRow` fires as each row arrives.
 * A stream that ends without `done` is an error carrying the partial report: the deep check did not finish.
 */
export async function readSseReport(body: ReadableStream<Uint8Array>, onRow?: (row: Row, report: Report) => void): Promise<Report> {
  let report: Report | undefined;
  let rowsSeen = 0;
  let done = false;
  try {
    for await (const event of sseEvents(body)) {
      if (event.name === "report") {
        report = JSON.parse(event.data) as Report;
      } else if (event.name === "row" && report) {
        const row = JSON.parse(event.data) as Row;
        const at = report.rows.findIndex((r) => r.n === row.n);
        if (at >= 0) report.rows[at] = row;
        else report.rows.push(row);
        rowsSeen += 1;
        onRow?.(row, report);
      } else if (event.name === "done" && report) {
        const d = JSON.parse(event.data) as { summary?: Summary; elapsed_s?: number };
        if (d.summary) report.summary = { ...report.summary, ...d.summary };
        if (d.elapsed_s !== undefined) report.elapsed_s = d.elapsed_s;
        delete report.summary.deep_pending; // the provisional count; every row has arrived
        done = true;
      }
    }
  } catch (cause) {
    throw incomplete(report, rowsSeen, cause);
  }
  if (!report) throw new ProofreadError(0, "stream_incomplete", "proofread.law's deep-check stream ended before it sent a report. Run the check again.");
  if (!done) throw incomplete(report, rowsSeen);
  return report;
}

function incomplete(report: Report | undefined, rowsSeen: number, cause?: unknown): ProofreadError {
  const expected = report?.summary.deep_pending;
  const how = cause instanceof Error && cause.name !== "TypeError" ? ` (${cause.name === "TimeoutError" ? "timed out" : cause.message})` : "";
  const progress = expected !== undefined ? `${rowsSeen} of ${expected} citations were deep-checked` : `${rowsSeen} citations were deep-checked`;
  const message = `proofread.law's deep-check stream ${cause ? "was cut" : "ended"} before it finished${how}: ${progress}. ` +
    "The result is incomplete; run the check again (without deep=true if this keeps happening).";
  return new ProofreadError(0, "stream_incomplete", message, { rows_seen: rowsSeen, expected, partial: report });
}

interface SseEvent {
  name: string;
  data: string;
}

/** Splits an SSE byte stream into events. One event = the lines up to a blank line. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let cut: number;
    while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
      const event = parseBlock(block);
      if (event) yield event;
    }
  }
  const last = parseBlock(buffer + decoder.decode());
  if (last) yield last;
}

function parseBlock(block: string): SseEvent | undefined {
  let name = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":") || line.trim() === "") continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") name = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { name, data: data.join("\n") } : undefined;
}
