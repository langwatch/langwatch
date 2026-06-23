export type TraceStatus = "ok" | "error" | "warning";

/**
 * Lightweight eval summary for table column rendering.
 * Full eval detail (reasoning, inputs, cost) is fetched on demand in the drawer.
 */
export interface EvalSummary {
  name: string;
  score: number | boolean;
  scoreType: "numeric" | "boolean" | "categorical";
  /**
   * - `pass` / `fail` / `warning` — the evaluator ran and produced a verdict.
   * - `skipped` — the evaluator wasn't run (e.g. provider not configured,
   *   preconditions not met). The score is meaningless; don't show it.
   * - `error` — the evaluator crashed / errored out. Distinct from a "fail"
   *   verdict — the evaluator never produced a real score.
   */
  status: "pass" | "warning" | "fail" | "skipped" | "error";
}

/**
 * Compact eval result attached to a trace list item.
 * Mapped from the server-side EvalSummary in the useTraceList hook.
 */
export interface TraceEvalResult {
  evaluatorId: string;
  evaluatorName: string | null;
  status: "scheduled" | "in_progress" | "processed" | "error" | "skipped";
  score: number | null;
  passed: boolean | null;
  label: string | null;
}

/**
 * Lightweight event reference attached to a trace list item.
 * Hoisted from spans during the fold projection.
 */
export interface TraceListEvent {
  spanId: string;
  timestamp: number;
  name: string;
}

/**
 * Shape of a trace as rendered in the trace table.
 * This is the client-side view model — not the ClickHouse row.
 * Only contains the data needed for table rendering. Heavy fields
 * (full I/O, span trees, eval reasoning) are fetched progressively.
 */
export interface TraceListItem {
  traceId: string;
  timestamp: number;
  name: string;
  serviceName: string;
  durationMs: number;
  /** Grand list-price cost. `nonBilledCost` is the bundled (theoretical)
   *  portion of it; billed = totalCost - nonBilledCost. */
  totalCost: number;
  nonBilledCost: number;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Cache + reasoning token sums (null when the model never reported them).
   *  The Tokens cell shows input+output; these drive the hover breakdown. */
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  reasoningTokens?: number | null;
  models: string[];
  /** Trace-level labels (`langwatch.labels`), rendered by the Labels column. */
  labels: string[];
  /** Managed prompt last used in the trace, for the Prompt column. */
  promptId?: string | null;
  promptVersionNumber?: number | null;
  status: TraceStatus;
  spanCount: number;
  /** Stored payload size of the trace in bytes (`_size_bytes` on
   *  trace_summaries), rendered by the optional Size column. 0 when absent. */
  sizeBytes: number;
  input: string | null;
  output: string | null;
  /**
   * Set when a restrict privacy rule hides the content from this viewer (the
   * server nulled `input`/`output`). Lets the Input/Output cells render a
   * "Redacted" marker instead of the em-dash used for genuinely-absent content.
   * `*VisibleTo` is the audience label ("Admins" / "no one") or null/undefined
   * for the generic copy.
   */
  inputRedacted?: boolean | null;
  outputRedacted?: boolean | null;
  inputVisibleTo?: string | null;
  outputVisibleTo?: string | null;
  error?: string;
  errorSpanName?: string;
  conversationId?: string;
  userId?: string;
  origin:
    | "application"
    | "simulation"
    | "evaluation"
    | "workflow"
    | "playground"
    | "gateway"
    | "sample"
    | "coding_agent"
    | "ai_tool"
    // CH `langwatch.origin` is a free string; keep the known set for
    // autocomplete/exhaustiveness while still accepting future values.
    | (string & {});
  tokensEstimated?: boolean;
  ttft?: number;
  traceName?: string;
  rootSpanType?: string | null;
  evaluations: TraceEvalResult[];
  events: TraceListEvent[];
}
