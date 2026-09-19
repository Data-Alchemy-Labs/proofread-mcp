import { checkCitations } from "./check_citations.js";
import { checkDocument } from "./check_document.js";
import { coverage } from "./coverage.js";
import { renderReport } from "./render_report.js";
import { resolveCitation } from "./resolve_citation.js";
import type { ToolDef } from "./tool.js";

// One file per tool. When the register API (/v1/resolve, /v1/extract, /v1/case, per-reporter coverage) lands,
// add a file here and a method on the client; nothing else changes.
export const tools: ToolDef[] = [checkCitations, checkDocument, resolveCitation, coverage, renderReport];
