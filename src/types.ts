// Shapes returned by https://proofread.law (see the service contract in citation-bench/app/README.md).
// Only the fields the server reads are typed; everything else passes through untouched.

export type Tier = "red" | "orange" | "green" | "white";

export interface Support {
  status: "confirmed" | "likely" | "not_confirmed" | "opposite" | "not_checked";
  headline?: string;
  confidence?: number;
  band?: "high" | "medium" | "low";
  passage?: string;
  note?: string;
}

export interface Evidence {
  register_name?: string;
  register_date?: string;
  court?: string;
  cluster_id?: number;
  citations?: string[];
  url?: string;
  cite_points_to?: string;
  resolve_match?: string;
}

export interface Row {
  n: number;
  tier: Tier;
  tier_label?: string;
  citation: string;
  cite?: string;
  parallel?: string[];
  parties?: string;
  year?: number;
  headline: string;
  detail?: string;
  notes?: string[];
  reason?: string; // "database_id" on Westlaw/Lexis rows
  occurrences?: number;
  evidence?: Evidence;
  support?: Support | null;
  [key: string]: unknown;
}

export interface Summary {
  citations: number;
  rows: number;
  red: number;
  orange: number;
  green: number;
  white: number;
  review_queue?: number;
  database_ids?: number;
  review_queue_excluding_database_ids?: number;
  deep_pending?: number;
  support?: { confirmed: number; likely: number; not_confirmed: number; opposite: number };
  [key: string]: unknown;
}

export interface Report {
  version?: string;
  mode: "default" | "deep";
  generated_at?: string;
  input?: { kind: string; pages?: number; bytes?: number; chars?: number };
  elapsed_s?: number;
  coverage: string;
  storage: string;
  summary: Summary;
  rows: Row[];
  [key: string]: unknown;
}

export interface Coverage {
  coverage: string;
  storage: string;
}

/** GET /v1/coverage?jurisdiction=ch: the Swiss register per court, with the share of the live index each court's holdings represent. */
export interface CoverageCh {
  statement: string | null;
  storage: string;
  available: boolean;
  freshness?: { dump?: string | null; live_index_checked?: string | null; schema?: number | null };
  courts?: { court: string; decisions: number; from?: string | null; to?: string | null; live_index_share?: number | null }[];
}

/** The error envelope every non-2xx answer carries: {"error": {"code", "message", ...}}. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    retry_after?: number;
    plan?: string;
    feature?: string;
    upgrade?: string;
    used?: number;
    limit?: number;
    [key: string]: unknown;
  };
}

// The register API (GET/POST /v1/resolve).

export type ResolveStatus = "found" | "ambiguous" | "not_found" | "unverifiable" | "beyond_register" | "known_cite" | "unresolvable" | "unparsed";

export interface ResolveCase {
  id: number;
  name: string;
  court?: string;
  date?: string;
  citations?: string[];
  url?: string;
}

export interface ResolveCoverage {
  register_coverage: string; // volume_present | volume_thin | volume_absent | database_id | ...
  reporter?: string;
  volume?: string;
  max_volume?: number;
  volume_n?: number;
  beyond_max?: boolean;
  [key: string]: unknown;
}

export interface ResolveResult {
  cite: string;
  normalized: string | null;
  status: ResolveStatus;
  case: ResolveCase | null;
  candidates: ResolveCase[];
  coverage: ResolveCoverage | null;
  match?: "exact" | "pincite";
  /** On unverifiable, beyond_register and not_found: why, and a ready sentence. Older API answers carry neither. */
  reason?: "recent" | "volume_thin" | "reporter_absent" | "volume_newer_than_register" | "page_absent" | string;
  note?: string;
  known_as?: { name: string; year?: number; court_hint?: string; n_citing?: number };
  freshness?: { dump: string; refreshed: string };
  coverage_statement?: string;
  [key: string]: unknown;
}

export interface ResolveBatch {
  results: ResolveResult[];
  freshness?: { dump: string; refreshed: string };
  coverage_statement: string;
  plan?: string;
  elapsed_s?: number;
}

// Agent onboarding (POST /agent/signup, POST /agent/checkout-link).

export interface SignupResult {
  api_key: string;
  key_prefix?: string;
  plan?: string;
  email?: string;
  agent_name?: string;
  limits?: { checks_per_month?: number; deep_checks_per_month?: number; resolves_per_month?: number; requests_per_hour?: number };
  [key: string]: unknown;
}

export interface CheckoutLink {
  checkout_url: string;
  plan?: string;
  note?: string;
}

// Saved briefs (/v1/briefs): opt-in, stored encrypted in the user's account. The API is newer than the rest, so every field the
// formatter reads is optional and a missing one is left out of the text rather than guessed. The API's ids are integers; the client
// turns them into strings, so `id` is a string everywhere past it.

/** The counts of a brief's latest check, as in a report's summary. */
export type BriefSummary = Partial<Summary>;

export interface BriefVersionInfo {
  v: number;
  created_at?: string;
  summary?: BriefSummary | null;
}

/** GET /v1/briefs, one entry. `versions` is a count here and a list (newest first) in GET /v1/briefs/{id}; both are read. */
export interface BriefListItem {
  id: string;
  title?: string | null;
  created_at?: string;
  updated_at?: string;
  last_checked_at?: string | null;
  n_citations?: number;
  summary?: BriefSummary | null;
  versions?: number | BriefVersionInfo[];
  [key: string]: unknown;
}

export interface BriefList {
  briefs: BriefListItem[];
  /** The plan's cap on saved briefs. */
  limit?: number;
}

/** POST /v1/briefs: the new brief and the report of its first check (same shape as POST /verify). */
export interface SavedBrief {
  id: string;
  title?: string | null;
  created_at?: string;
  updated_at?: string;
  summary?: BriefSummary | null;
  report: Report;
  [key: string]: unknown;
}

/** GET /v1/briefs/{id}: the saved text, the latest report and the versions kept. */
export interface Brief {
  id: string;
  title?: string | null;
  text?: string;
  report?: Report | null;
  summary?: BriefSummary | null;
  created_at?: string;
  updated_at?: string;
  versions?: BriefVersionInfo[];
  [key: string]: unknown;
}

/** One flag in a PUT's changes: {citation, parties, tier, headline} (fields may be null), or a plain citation string. */
export type BriefChangeItem = string | { citation?: string | null; parties?: string | null; tier?: Tier | null; headline?: string | null; [key: string]: unknown };

export interface BriefChanges {
  resolved: BriefChangeItem[];
  new: BriefChangeItem[];
  unchanged: number;
}

/** PUT /v1/briefs/{id}: the brief after the edit, with what the re-check changed (absent when only the title changed). */
export interface UpdatedBrief extends Brief {
  changes?: BriefChanges | null;
}

/** GET /v1/briefs/{id}/versions/{v}. */
export interface BriefVersion {
  v: number;
  created_at?: string;
  text: string;
  summary?: BriefSummary | null;
}

// Case suggestions, Switzerland (GET and POST /v1/suggest): a federal statute article -> the leading Federal Supreme Court cases (BGE)
// cited with it, one list in the measured order, each row labelled with its field. Every string a reader sees (read_as, filter_note,
// message, notes, about, fields, labels, practice flags) comes back worded in the query's language (de/fr/it, or en), so the formatter
// prints them as they are. The API is new: every field past the status is optional
// and a missing one is left out of the text rather than guessed.

export type SuggestDomain = "all" | "civil" | "criminal" | "public" | "social";
export type SuggestLang = "de" | "fr" | "it" | "en";
/** ok, no_article (no statute article recognised in the query), not_indexed (the articles named have no leading case in the index). */
export type SuggestStatus = "ok" | "no_article" | "not_indexed";

export interface SuggestArticle {
  law: string;
  art: string;
  para?: string | null;
  label: string;
  indexed?: boolean;
  [key: string]: unknown;
}

/** A later change of practice on a suggested decision. A changed precedent is always listed with its flag, never dropped. */
export interface PracticeFlag {
  kind: "practice_changed" | "practice_clarified" | string;
  text: string;
  lines?: string[];
  by?: string | null;
  url?: string | null;
  [key: string]: unknown;
}

export interface SuggestResult {
  /** The position in the full measured list: 1..n unfiltered; under a domain filter the rows keep their overall rank (7, 9, 10...). */
  rank: number;
  ref: string;
  /** Localised, with the consideration when there is one: "ATF 132 III 122 consid. 4.3". */
  cite: string;
  date?: string | null;
  date_display?: string | null;
  /** The decision's own language. */
  language?: string | null;
  domain?: string | null;
  field?: string | null;
  home_domain?: boolean;
  passage?: string | null;
  passage_kind?: "regeste" | "reasons" | "regeste_start" | string;
  passage_label?: string | null;
  passage_language?: string | null;
  erw?: string | null;
  /** The regeste as context line, on rows whose passage comes from the reasons. */
  regeste?: string | null;
  regeste_label?: string | null;
  score?: number;
  /** The decision at the court's site. */
  url?: string | null;
  /** A path on proofread.law that opens the checker with this citation filled in. */
  check_url?: string | null;
  rank_label?: string | null;
  open_label?: string | null;
  check_label?: string | null;
  practice?: PracticeFlag[];
  [key: string]: unknown;
}

/** How many candidates the article has in all, and per field; the web page shows them on the filter buttons. */
export interface SuggestCounts {
  candidates?: number;
  by_field?: Partial<Record<"civil" | "criminal" | "public" | "social", number>>;
  unassigned?: number;
  shown?: number;
  flagged?: number;
  [key: string]: unknown;
}

export interface SuggestAnswer {
  status: SuggestStatus | string;
  language?: string;
  query_language?: string;
  understood?: SuggestArticle[];
  read_as?: string | null;
  /** Set when domain is not all: the field shown, in the same order as the full list. */
  filter_note?: string | null;
  /** Set for no_article and not_indexed, and when a domain filter leaves no rows. */
  message?: string | null;
  notes?: string[];
  domain?: string;
  k?: number;
  home_domains?: string[];
  /** One list in the measured order (empty for no_article, not_indexed, or a filter that leaves no rows). */
  results?: SuggestResult[];
  counts?: SuggestCounts | null;
  practice_layer?: boolean | null;
  /** The method and its measured numbers, one paragraph. */
  about?: string | null;
  method?: Record<string, unknown> | null;
  plan?: string;
  elapsed_s?: number;
  [key: string]: unknown;
}
