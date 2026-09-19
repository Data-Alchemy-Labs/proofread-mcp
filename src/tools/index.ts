import { checkCitations } from "./check_citations.js";
import { checkDocument } from "./check_document.js";
import { coverage } from "./coverage.js";
import { renderReport } from "./render_report.js";
import { resolveCitation } from "./resolve_citation.js";
import { resolveCitations } from "./resolve_citations.js";
import type { ToolDef } from "./tool.js";

// One file per tool. The remaining register routes (/v1/extract, /v1/case/{id}, /v1/coverage per reporter) slot in the same way:
// a method on the client, a file here.
export const tools: ToolDef[] = [checkCitations, checkDocument, resolveCitation, resolveCitations, coverage, renderReport];
