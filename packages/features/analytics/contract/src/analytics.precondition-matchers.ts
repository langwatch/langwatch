import type { FilterField } from "./analytics.filter-field";

/**
 * How a filter field is READ off a trace held in memory.
 *
 * The twin of the ClickHouse condition builders: one decides what a field
 * means in SQL, this decides what the same field means against a trace the
 * process already has. Both are keyed by `FilterField`, so a field added to
 * the enum without an entry here fails to compile — the same guarantee the
 * SQL side gets, for the side that runs when there is no query to run.
 *
 * It lives in the contract rather than beside either consumer because both
 * ends need it and they are on opposite sides of the browser boundary: the
 * evaluator's precondition editor resolves fields to preview a rule, and a
 * background process resolves the same fields to confirm a settled match. A
 * second table would let the preview and the confirmation disagree.
 */

// ---------------------------------------------------------------------------
// PreconditionTraceData — unified trace data for in-memory matching
// ---------------------------------------------------------------------------

/**
 * Unified trace data available for precondition matching.
 * Supports both the legacy collector path (ElasticSearchTrace) and
 * the event-sourcing path (TraceSummaryData fold state + spans).
 */
export interface PreconditionTraceData {
  input?: string | null;
  output?: string | null;
  origin?: string | null;
  hasError?: boolean | null;
  userId?: string | null;
  threadId?: string | null;
  customerId?: string | null;
  labels?: string[] | null;
  promptIds?: string[] | null;
  topicId?: string | null;
  subTopicId?: string | null;
  spanTypes?: string[] | null;
  spanModels?: string[] | null;
  customMetadata?: Record<string, string | null> | null;
  annotationIds?: string[];
  events?: Array<{
    event_type: string;
    metrics: Array<{ key: string; value: number }>;
    event_details: Array<{ key: string; value: string }>;
  }> | null;
}

// ---------------------------------------------------------------------------
// PreconditionField — all possible precondition fields
// ---------------------------------------------------------------------------

/** All fields that can be used in preconditions: every FilterField plus input/output */
export type PreconditionField = FilterField | "input" | "output";

// ---------------------------------------------------------------------------
// PreconditionFieldMatcher
// ---------------------------------------------------------------------------

/**
 * Resolves a field value from trace data for precondition evaluation.
 * Returns the resolved value as a string, string array, or null/undefined.
 *
 * @param data - The unified trace data
 * @param value - The precondition value (for context, not used in resolution)
 * @param key - Optional key for nested filters (e.g., metadata key name)
 * @param subkey - Optional subkey for double-nested filters
 */
export type PreconditionFieldMatcher = (
  data: PreconditionTraceData,
  value: string,
  key?: string,
  subkey?: string,
) => string | string[] | null | undefined;

// ---------------------------------------------------------------------------
// Matcher registry — one matcher per PreconditionField
// ---------------------------------------------------------------------------

/**
 * Exhaustive registry mapping each precondition field to its matcher function.
 * Fields set to `null` are key-selector fields or not available at trace
 * arrival time, and cannot be used as standalone precondition values.
 */
export const PRECONDITION_FIELD_MATCHERS: Record<
  PreconditionField,
  PreconditionFieldMatcher | null
> = {
  // Precondition-only fields
  input: (data) => data.input,
  output: (data) => data.output,

  // Trace fields
  "traces.origin": (data) => data.origin ?? null,
  "traces.error": (data) => (data.hasError != null ? (data.hasError ? "true" : "false") : "false"),
  "traces.name": null, // TraceName is a ClickHouse-only analytics dimension, not available at trace arrival time

  // Metadata fields
  "metadata.user_id": (data) => data.userId,
  "metadata.thread_id": (data) => data.threadId,
  "metadata.customer_id": (data) => data.customerId,
  "metadata.labels": (data) => data.labels,
  "metadata.prompt_ids": (data) => data.promptIds,
  "metadata.key": null, // key selector — not matchable
  "metadata.value": (data, _value, key) => {
    if (!key) return null;
    const decoded = key.replaceAll("·", ".");
    const resolved = decoded.startsWith("metadata.")
      ? decoded.slice("metadata.".length)
      : decoded.startsWith("langwatch.metadata.")
        ? decoded.slice("langwatch.metadata.".length)
        : decoded;
    return resolved ? (data.customMetadata?.[resolved] ?? null) : null;
  },

  // Span fields
  "spans.type": (data) => data.spanTypes,
  "spans.model": (data) => data.spanModels,

  // Topic fields
  "topics.topics": (data) => (data.topicId ? [data.topicId] : null),
  "topics.subtopics": (data) => (data.subTopicId ? [data.subTopicId] : null),

  // Evaluation fields — not available at trace arrival time
  "evaluations.evaluator_id": null,
  "evaluations.evaluator_id.guardrails_only": null,
  "evaluations.evaluator_id.has_passed": null,
  "evaluations.evaluator_id.has_score": null,
  "evaluations.evaluator_id.has_label": null,
  "evaluations.passed": null,
  "evaluations.score": null,
  "evaluations.state": null,
  "evaluations.label": null,

  // Event fields — fetched on demand when event preconditions exist
  "events.event_type": (data) => data.events?.map((e) => e.event_type) ?? null,
  "events.metrics.key": (data, _value, key) => {
    if (!key || !data.events) return null;
    const event = data.events.find((e) => e.event_type === key);
    return event?.metrics.map((m) => m.key) ?? null;
  },
  "events.metrics.value": null, // numeric range — matched in-memory by LegacyFilterMatchingService, not through this string-based registry
  "events.event_details.key": (data, _value, key) => {
    if (!key || !data.events) return null;
    const event = data.events.find((e) => e.event_type === key);
    return event?.event_details.map((d) => d.key) ?? null;
  },

  // Annotation fields
  "annotations.hasAnnotation": (data) =>
    data.annotationIds != null ? (data.annotationIds.length > 0 ? "true" : "false") : null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Applies business-layer defaults to trace data before precondition evaluation.
 * Mirrors the ClickHouse read-boundary normalization (filter-conditions.ts)
 * and the deferred origin stamping (traceSummary.foldProjection.ts).
 */
export function normalizePreconditionTraceData(data: PreconditionTraceData): PreconditionTraceData {
  return { ...data, origin: data.origin ?? "application" };
}
