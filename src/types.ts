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
