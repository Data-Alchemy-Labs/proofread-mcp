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
