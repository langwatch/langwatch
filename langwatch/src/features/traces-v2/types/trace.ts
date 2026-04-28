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
  totalCost: number;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  models: string[];
  status: TraceStatus;
  spanCount: number;
  input: string | null;
  output: string | null;
  error?: string;
  errorSpanName?: string;
  conversationId?: string;
  userId?: string;
  origin: "application" | "simulation" | "evaluation";
  tokensEstimated?: boolean;
  ttft?: number;
  rootSpanName?: string | null;
  rootSpanType?: string | null;
  evaluations: TraceEvalResult[];
  events: TraceListEvent[];
}
