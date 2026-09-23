import type { FilterField } from "./analytics.filter-field.ts";

/**
 * Maps FilterFields to trace data—keyed so adding a field without a matcher is
 * a compile error. Same guarantee as the SQL builders, for the in-memory path.
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
  /**
   * Raw trace-summary attributes, unfiltered: `metadata.value` reads these so
   * a bare OTEL resource attribute resolves the way it resolves in ClickHouse,
   * which ORs the three attribute spellings of one metadata key.
   */
  attributes?: Record<string, string> | null;
  annotationIds?: string[];
  events?:
    | {
        event_type: string;
        metrics: { key: string; value: number }[];
        event_details: { key: string; value: string }[];
      }[]
    | null;
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
 * Resolves a field value from trace data for precondition evaluation; returns
 * string, string array, or null.
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
  "traces.error": (data) => (data.hasError ? "true" : "false"),
  "traces.name": null, // ClickHouse-only analytics dimension, not in trace data

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
    let resolved = decoded;
    if (decoded.startsWith("metadata.")) {
      resolved = decoded.slice("metadata.".length);
    } else if (decoded.startsWith("langwatch.metadata.")) {
      resolved = decoded.slice("langwatch.metadata.".length);
    }
    if (!resolved) {
      return null;
    }

    // customMetadata alone cannot answer this: it drops standard resource
    // prefixes and keeps only the highest-priority form of a key, while
    // ClickHouse matches any of the three spellings.
    const candidates = [
      data.attributes?.[`metadata.${decoded}`],
      data.attributes?.[`langwatch.metadata.${decoded}`],
      data.attributes?.[decoded],
      data.customMetadata?.[resolved],
    ].filter((candidate): candidate is string => candidate != null);

    // A lone value stays a plain string: `matches_regex` tests an array's JSON
    // encoding alongside its elements, so a list would widen what an anchored
    // pattern can hit.
    const [first, ...rest] = [...new Set(candidates)];
    if (first === void 0) {
      return null;
    }

    return rest.length === 0 ? first : [first, ...rest];
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
  "events.metrics.value": null, // numeric range; matched separately
  "events.event_details.key": (data, _value, key) => {
    if (!key || !data.events) return null;
    const event = data.events.find((e) => e.event_type === key);
    return event?.event_details.map((d) => d.key) ?? null;
  },

  // Annotation fields
  "annotations.hasAnnotation": (data) => {
    if (data.annotationIds == null) return null;
    return data.annotationIds.length > 0 ? "true" : "false";
  },
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
