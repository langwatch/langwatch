import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import type { TraceMediaRef } from "~/shared/traces/media-refs";

export type TraceStatus = "ok" | "error" | "warning";

/**
 * Lightweight eval summary for table column rendering.
 * Full eval detail (reasoning, inputs, cost) is fetched on demand in the drawer.
 */
export interface EvalSummary {
  name: string;
  score: number | boolean | null;
  scoreType: "numeric" | "boolean" | "categorical";
  /**
   * - `pass` / `fail` / `warning` — the evaluator ran and produced a verdict.
   * - `skipped` — the evaluator wasn't run (e.g. provider not configured,
   *   preconditions not met). The score is meaningless; don't show it.
   * - `error` — the evaluator crashed / errored out. Distinct from a "fail"
   *   verdict — the evaluator never produced a real score.
   */
  status: "pass" | "warning" | "fail" | "skipped" | "error" | "processed";
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
 * One event name a trace recorded, with how often it fired. Rows show one
 * badge per name, not per event: an agent turn that retries a tool 237 times
 * has 237 `tool.output` events and one thing worth saying about them.
 */
export interface TraceListEventGroup {
  name: string;
  count: number;
  /** Epoch ms of the earliest event under this name — the badge order. */
  firstTimestamp: number;
}

/**
 * A trace's events as the list renders them. Read from `stored_spans` by
 * `tracesV2.listEvents` once per visible page, not carried on the trace
 * summary — the fold stopped hoisting events so that folding stays O(1) per
 * span (migration 00025).
 */
export interface TraceListEvents {
  /** Ordered by first occurrence; shorter than `distinctCount` when trimmed. */
  groups: TraceListEventGroup[];
  /** Every event the trace recorded, including names beyond the trim. */
  totalCount: number;
  /** Distinct names the trace recorded, including those beyond the trim. */
  distinctCount: number;
}

/** A trace with no events, and the shape a row carries before they load. */
export const NO_TRACE_EVENTS: TraceListEvents = {
  groups: [],
  totalCount: 0,
  distinctCount: 0,
};

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
  /** Context already carried into the trace's first model call (not a sum). */
  contextSizeTokens?: number | null;
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
   * Compact media references derived at fold time from the winning span IO
   * (thumbnail/player indicators for the table without span payloads).
   * Absent on media-free traces and summaries folded before the field existed.
   */
  inputMediaRefs?: TraceMediaRef[];
  outputMediaRefs?: TraceMediaRef[];
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
  events: TraceListEvents;
  /**
   * True while the page's events read is still in flight. The Events column
   * shows a placeholder rather than its empty marker, which would otherwise
   * claim the trace recorded nothing.
   */
  eventsLoading?: boolean;
  /**
   * True when the page's events read failed. The column says so instead of
   * showing its empty marker, which would report a trace that has events as
   * having none.
   */
  eventsUnavailable?: boolean;
  /**
   * What reviewers left on the trace: their comments, ratings, scores and
   * suggested outputs. Annotations live in their own store rather than on the
   * trace summary, so the list reads them separately and lays them over the
   * row (`useTraceListAnnotations`). Undefined until the Annotations column
   * asks for them.
   */
  annotations?: AnnotationByTrace[];
  /**
   * True while the page's annotations read is still in flight. The column
   * holds the space rather than showing its empty marker, which would claim
   * nobody has reviewed the trace.
   */
  annotationsLoading?: boolean;
  /**
   * True when the page's annotations could not be read, whether the read
   * failed or the reader may not see them. The column says so instead of
   * reporting a reviewed trace as unreviewed.
   */
  annotationsUnavailable?: boolean;
}
