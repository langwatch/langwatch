import type {
  ChatMessage,
  Evaluation,
  EvaluationResult,
  LLMSpan,
  Span,
  SpanTimestamps,
  Trace,
} from "./trace-format.schemas";

/**
 * The results the legacy trace read answers with.
 *
 * They are the contract between that read and every transport over it — the
 * tRPC surface, the v1 REST search, the export composer — so they live beside
 * the trace formats they are built from rather than inside any one caller. The
 * INPUTS stay application-owned for now: they are derived from the shared
 * analytics filter schema and the projection plan, neither of which has left
 * the application yet.
 */

/**
 * A trace as the list/search read returns it: the stored trace plus the two
 * things that read joins on — the guardrail that blocked it, if one did, and
 * whether it carries annotations.
 */
export type TraceWithGuardrail = Trace & {
  lastGuardrail: (EvaluationResult & { name?: string }) | undefined;
  annotations?: {
    hasAnnotation: boolean;
    count: number;
  };
};

/**
 * Result structure for getAllTracesForProject.
 * Used by the ClickHouse trace service.
 */
export interface TracesForProjectResult {
  groups: TraceWithGuardrail[][];
  totalHits: number;
  traceChecks: Record<string, Evaluation[]>;
  scrollId?: string;
  /**
   * Updated axis only. The upper bound this scroll actually covered, in epoch
   * ms — the moment it was pinned to, which is at or before the requested
   * `endDate`.
   *
   * A scroll reads each trace as of its start so mid-scroll writes cannot move
   * rows out from under the cursor. The cost is that anything written after
   * that instant is not in this scroll, even when the requested window extends
   * past it. A client that resumed from the `endDate` it asked for would step
   * over that gap and lose those traces; resuming from this value cannot.
   *
   * Both ends of the window are inclusive, so a trace last written at exactly
   * this millisecond is delivered by this pull and by the next one. That is the
   * axis's at-least-once guarantee doing its job — a duplicate is recoverable
   * by an idempotent apply, a gap is not — and it is why resuming here is the
   * advice rather than resuming one millisecond past it.
   *
   * Absent on the occurred axis, which needs no snapshot: OccurredAt does not
   * move, so the requested window is the window delivered.
   */
  updatedThrough?: number;
}

/**
 * Result structure for topic count aggregations.
 */
export interface TopicCountsResult {
  topicCounts: Array<{ key: string; count: number }>;
  subtopicCounts: Array<{ key: string; count: number }>;
}

/**
 * Result structure for customers and labels aggregations.
 */
export interface CustomersAndLabelsResult {
  customers: string[];
  labels: string[];
}

/**
 * Result structure for getDistinctFieldNames.
 * Returns unique span names, metadata keys and evaluator names for a project,
 * so field-mapping dropdowns can offer every name the project produced (not
 * just the ones on the currently loaded trace).
 *
 * Evaluation entries carry the evaluator id as `key` and its display name as
 * `label`; the other arrays use the name for both.
 *
 * Event types are intentionally not included here: they live only inside the
 * heavy `stored_spans.SpanAttributes` map (the trace_summaries event columns
 * were dropped in migration 00025), so scanning them in this query would
 * materialise that column — exactly the OOM/IO vector the memory-safety guard
 * protects against. The events dropdown instead gets its project-wide options
 * from the bounded analytics event-type filter query (see useProjectEventTypes).
 */
export interface DistinctFieldNamesResult {
  spanNames: Array<{ key: string; label: string }>;
  metadataKeys: Array<{ key: string; label: string }>;
  evaluationNames: Array<{ key: string; label: string }>;
}

/**
 * Result structure for getSpanForPromptStudio.
 * Contains all the data needed to populate the prompt studio UI.
 */
export interface PromptStudioSpanResult {
  spanId: string;
  traceId: string;
  spanName: string | null;
  messages: ChatMessage[];
  llmConfig: {
    model: string | null;
    systemPrompt: ChatMessage["content"];
    temperature: number | null;
    maxTokens: number | null;
    topP: number | null;
    frequencyPenalty: number | null;
    presencePenalty: number | null;
    seed: number | null;
    topK: number | null;
    minP: number | null;
    repetitionPenalty: number | null;
    reasoning: string | null;
    verbosity: string | null;
    litellmParams: Record<string, unknown>;
  };
  vendor: string | null;
  error: Span["error"] | null;
  timestamps: SpanTimestamps | undefined;
  metrics: LLMSpan["metrics"] | null;
  /** Prompt handle from span attributes (new combined or old format) */
  promptHandle: string | null;
  /** Prompt version number from span attributes (new combined or old format) */
  promptVersionNumber: number | null;
  /** Prompt tag from span attributes (e.g., "production", "staging") */
  promptTag: string | null;
  /** Prompt variables extracted from span attributes */
  promptVariables: Record<string, string> | null;
}

/**
 * The minimum every legacy trace read is scoped by: one project and one
 * window over the occurred axis.
 *
 * A deployment's real filter schema is richer — the shared analytics filters,
 * free text, a trace-id list, negation — and it is the application that owns
 * it. What a transport and the read agree on is only this much, which is what
 * lets the transport accept the application's schema unchanged while still
 * naming what it passes on.
 */
export type TraceLegacyFilterInput = {
  projectId: string;
  startDate: number;
  endDate: number;
};

/** The same, plus the paging and ordering the list/search read understands. */
export type TraceLegacyListInput = TraceLegacyFilterInput & {
  query?: string;
  pageSize?: number;
  groupBy?: string;
  sortBy?: string;
  sortDirection?: string;
  /** Keyset cursor. Offset paging was removed in the ClickHouse migration. */
  scrollId?: string | null;
  updatedAt?: number;
};
