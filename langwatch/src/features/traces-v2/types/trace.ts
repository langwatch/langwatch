/**
 * Span-level type used for coloring in drawer views (waterfall, flame, span list).
 * Not associated with TraceListItem — traces no longer carry a top-level spanType.
 */
export type SpanType =
  | "llm"
  | "tool"
  | "agent"
  | "chain"
  | "rag"
  | "evaluation"
  | "span"
  | "module";

export type TraceStatus = "ok" | "error" | "warning";

export type Origin = "application" | "simulation" | "evaluation";

/**
 * Lightweight eval summary for table column rendering.
 * Full eval detail (reasoning, inputs, cost) is fetched on demand in the drawer.
 */
export interface EvalSummary {
  name: string;
  score: number | boolean;
  scoreType: "numeric" | "boolean" | "categorical";
  status: "pass" | "warning" | "fail";
}

/**
 * Lightweight event summary for table column rendering.
 * Full event detail (attributes, stack traces) is fetched on demand in the drawer.
 */
export interface EventSummary {
  name: string;
  isException: boolean;
  isFeedback: boolean;
  feedbackDirection?: "up" | "down";
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
  origin: Origin;
  tokensEstimated?: boolean;
  ttft?: number;
  rootSpanName?: string | null;
  rootSpanType?: string | null;
  evaluations: TraceEvalResult[];
  events: TraceListEvent[];
}

export interface ConversationTurn {
  turnNumber: number;
  trace: TraceListItem;
}

export interface Conversation {
  conversationId: string;
  turns: ConversationTurn[];
  totalDurationMs: number;
  totalCost: number;
  totalTokens: number;
  firstTimestamp: number;
  lastTimestamp: number;
  models: string[];
  toolCallCount: number;
  errorCount: number;
}
