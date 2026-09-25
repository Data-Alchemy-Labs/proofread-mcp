import { billingLink } from "./billing_link.js";
import { checkCitations } from "./check_citations.js";
import { checkDocument } from "./check_document.js";
import { coverage } from "./coverage.js";
import { deleteBrief } from "./delete_brief.js";
import { getBrief } from "./get_brief.js";
import { listBriefs } from "./list_briefs.js";
import { renderReport } from "./render_report.js";
import { resolveCitation } from "./resolve_citation.js";
import { resolveCitations } from "./resolve_citations.js";
import { saveBrief } from "./save_brief.js";
import { signUp } from "./sign_up.js";
import { suggestCases } from "./suggest_cases.js";
import type { ToolDef } from "./tool.js";
import { updateBrief } from "./update_brief.js";

// One file per tool. The remaining register routes (/v1/extract, /v1/case/{id}, /v1/coverage per reporter) slot in the same way:
// a method on the client, a file here.
export const tools: ToolDef[] = [
  checkCitations, checkDocument, resolveCitation, resolveCitations, coverage, renderReport,
  suggestCases, // Swiss statute article -> leading cases to read (paid plans and trials for now)
  saveBrief, listBriefs, getBrief, updateBrief, deleteBrief, // saved briefs: opt-in, encrypted in the user's account
  signUp, billingLink,
];
