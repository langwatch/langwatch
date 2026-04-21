import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type {
  PreconditionTraceData,
  PreconditionFieldMatcher,
} from "./precondition-matchers";
import { PRECONDITION_FIELD_MATCHERS } from "./precondition-matchers";
import type { FilterField, TriggerFilterValue, TriggerFilters } from "./types";

const EVALUATION_FIELDS: ReadonlySet<string> = new Set([
  "evaluations.evaluator_id",
  "evaluations.evaluator_id.guardrails_only",
  "evaluations.evaluator_id.has_passed",
  "evaluations.evaluator_id.has_score",
  "evaluations.evaluator_id.has_label",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.state",
  "evaluations.label",
]);

/** Fields that have no in-memory matcher (key-selectors, numeric-only). Skipped during matching. */
const UNSUPPORTED_FIELDS: ReadonlySet<string> = new Set([
  "metadata.key",
  "events.metrics.value",
  "events.event_details.value",
]);

/** Event filter fields that require events data to be populated. */
const EVENT_FIELDS: ReadonlySet<string> = new Set([
  "events.event_type",
  "events.metrics.key",
  "events.event_details.key",
]);

/**
 * Returns true if the given filters include any event-based fields that
 * require events data to be populated on PreconditionTraceData.
 */
export function hasEventFilters(filters: TriggerFilters): boolean {
  return Object.keys(filters).some((field) => EVENT_FIELDS.has(field));
}

/**
 * Splits trigger filters into trace-time-available and evaluation-time-available groups.
 */
export function classifyTriggerFilters(filters: TriggerFilters): {
  traceFilters: TriggerFilters;
  evaluationFilters: TriggerFilters;
  hasEvaluationFilters: boolean;
} {
  const traceFilters: TriggerFilters = {};
  const evaluationFilters: TriggerFilters = {};

  for (const [field, value] of Object.entries(filters) as [
    FilterField,
    TriggerFilterValue,
  ][]) {
    if (EVALUATION_FIELDS.has(field)) {
      evaluationFilters[field] = value;
    } else {
      traceFilters[field] = value;
    }
  }

  return {
    traceFilters,
    evaluationFilters,
    hasEvaluationFilters: Object.keys(evaluationFilters).length > 0,
  };
}

/**
 * Populates the events field on PreconditionTraceData from Trace events.
 * Call this when event filter fields are present and a full trace has been fetched.
 */
export function populateEventsOnTraceData(
  traceData: PreconditionTraceData,
  traceEvents: Array<{
    event_type: string;
    metrics: Record<string, number>;
    event_details: Record<string, string>;
  }>,
): PreconditionTraceData {
  return {
    ...traceData,
    events: traceEvents.map((e) => ({
      event_type: e.event_type,
      metrics: Object.entries(e.metrics).map(([key, value]) => ({ key, value })),
      event_details: Object.entries(e.event_details).map(([key, value]) => ({ key, value })),
    })),
  };
}

/**
 * Converts TraceSummaryData (fold state) into PreconditionTraceData for
 * in-memory filter matching. Extracts structured fields from the flat
 * attributes map, mirroring the logic in evaluationTrigger.reactor.ts.
 */
export function buildPreconditionTraceDataFromFoldState(
  foldState: TraceSummaryData,
): PreconditionTraceData {
  const attrs = foldState.attributes ?? {};

  return {
    input: foldState.computedInput ?? null,
    output: foldState.computedOutput ?? null,
    origin: attrs["langwatch.origin"] ?? null,
    hasError: foldState.containsErrorStatus,
    userId: attrs["langwatch.user_id"] ?? null,
    threadId: attrs["gen_ai.conversation.id"] ?? null,
    customerId: attrs["langwatch.customer_id"] ?? null,
    labels: parseJsonArray(attrs["langwatch.labels"]),
    promptIds: parseJsonArray(attrs["langwatch.prompt_ids"]),
    topicId: foldState.topicId ?? null,
    subTopicId: foldState.subTopicId ?? null,
    spanModels: foldState.models.length > 0 ? foldState.models : null,
    customMetadata: extractCustomMetadata(attrs),
    annotationIds: foldState.annotationIds,
  };
}

/**
 * Evaluates trigger filters in-memory against trace data.
 *
 * Semantics match the ClickHouse query builder:
 * - Within a field: OR (any filter value matches → field passes)
 * - Across fields: AND (all fields must pass)
 *
 * Evaluation fields are skipped (they return false for the whole trigger
 * if present — the caller should use classifyTriggerFilters to check first).
 */
export function matchesTriggerFilters(
  traceData: PreconditionTraceData,
  filters: TriggerFilters,
): boolean {
  for (const [field, filterValue] of Object.entries(filters) as [
    FilterField,
    TriggerFilterValue,
  ][]) {
    if (!filterValue) continue;

    // Skip evaluation fields — not available at trace time
    if (EVALUATION_FIELDS.has(field)) return false;

    // Skip fields with no in-memory matcher (key-selectors, numeric-only)
    if (UNSUPPORTED_FIELDS.has(field)) continue;

    if (!matchField(traceData, field, filterValue)) {
      return false;
    }
  }

  return true;
}

/**
 * Matches a single filter field against trace data.
 * Handles three filter value shapes:
 *   - string[] — simple array (e.g., "spans.model": ["gpt-4", "gpt-5-mini"])
 *   - Record<string, string[]> — keyed (e.g., "metadata.value": { "env": ["prod"] })
 *   - Record<string, Record<string, string[]>> — double-keyed
 */
function matchField(
  traceData: PreconditionTraceData,
  field: FilterField,
  filterValue: TriggerFilterValue,
): boolean {
  // Simple array: resolve field and check if any value matches
  if (Array.isArray(filterValue)) {
    if (filterValue.length === 0) return true;
    return matchSimpleArray(traceData, field, filterValue);
  }

  // Nested object: OR across keys (matches ClickHouse filter generation)
  let hasActionableCondition = false;

  for (const [key, subValue] of Object.entries(filterValue)) {
    if (Array.isArray(subValue)) {
      // Record<string, string[]> — resolve with key
      if (subValue.length === 0) continue;
      hasActionableCondition = true;
      if (matchSimpleArray(traceData, field, subValue, key)) {
        return true;
      }
    } else if (typeof subValue === "object" && subValue !== null) {
      // Record<string, Record<string, string[]>> — resolve with key + subkey
      for (const [subkey, values] of Object.entries(subValue)) {
        if (!Array.isArray(values) || values.length === 0) continue;
        hasActionableCondition = true;
        if (matchSimpleArray(traceData, field, values, key, subkey)) {
          return true;
        }
      }
    }
  }

  return !hasActionableCondition;
}

/**
 * Resolves a field value using the precondition matcher registry and
 * checks if any of the filter values match.
 */
function matchSimpleArray(
  traceData: PreconditionTraceData,
  field: FilterField,
  filterValues: string[],
  key?: string,
  subkey?: string,
): boolean {
  const matcher: PreconditionFieldMatcher | null | undefined =
    PRECONDITION_FIELD_MATCHERS[field];

  // Key-selector fields (metadata.key) and unavailable fields
  if (!matcher) return false;

  const resolved = matcher(traceData, filterValues[0]!, key, subkey);

  if (resolved == null) return false;

  // Resolved is a single string — check membership
  if (typeof resolved === "string") {
    return filterValues.includes(resolved);
  }

  // Resolved is an array — check if any element is in the filter values
  if (Array.isArray(resolved)) {
    return resolved.some((v) => filterValues.includes(v));
  }

  return false;
}

/**
 * Evaluates evaluation-specific filters against a set of completed evaluations.
 *
 * Semantics:
 * - For evaluator_id filters (string[]): at least one evaluation has a matching evaluatorId
 * - For keyed filters (Record<string, string[]>): for each key (evaluatorId),
 *   at least one evaluation with that evaluatorId has a matching value
 * - For double-keyed filters (evaluations.score): same but with subkey ignored
 *   (EvaluationRunData has a single score field)
 * - Across fields: AND (all must pass)
 */
export function matchesEvaluationFilters(
  evaluations: EvaluationRunData[],
  filters: TriggerFilters,
): boolean {
  for (const [field, filterValue] of Object.entries(filters) as [
    FilterField,
    TriggerFilterValue,
  ][]) {
    if (!filterValue) continue;

    // Only process evaluation fields
    if (!EVALUATION_FIELDS.has(field)) continue;

    if (!matchEvaluationField(evaluations, field, filterValue)) {
      return false;
    }
  }

  return true;
}

function matchEvaluationField(
  evaluations: EvaluationRunData[],
  field: FilterField,
  filterValue: TriggerFilterValue,
): boolean {
  // Simple array filters: evaluations.evaluator_id and variants
  if (Array.isArray(filterValue)) {
    if (filterValue.length === 0) return true;
    return matchEvaluatorIdFilter(evaluations, field, filterValue);
  }

  // Keyed filters: evaluations.passed, evaluations.state, evaluations.label, evaluations.score
  for (const [evaluatorId, subValue] of Object.entries(filterValue)) {
    const evalsForEvaluator = evaluations.filter(
      (e) => e.evaluatorId === evaluatorId,
    );
    if (evalsForEvaluator.length === 0) return false;

    if (Array.isArray(subValue)) {
      // Record<string, string[]> — e.g., evaluations.passed: { "eval-1": ["true"] }
      if (subValue.length === 0) continue;
      if (!matchEvaluationValues(evalsForEvaluator, field, subValue)) {
        return false;
      }
    } else if (typeof subValue === "object" && subValue !== null) {
      // Record<string, Record<string, string[]>> — evaluations.score: { "eval-1": { "score": ["0.5"] } }
      for (const [, values] of Object.entries(subValue)) {
        if (!Array.isArray(values) || values.length === 0) continue;
        if (!matchEvaluationValues(evalsForEvaluator, field, values)) {
          return false;
        }
      }
    }
  }

  return true;
}

function matchEvaluatorIdFilter(
  evaluations: EvaluationRunData[],
  field: FilterField,
  evaluatorIds: string[],
): boolean {
  switch (field) {
    case "evaluations.evaluator_id":
      return evaluations.some((e) => evaluatorIds.includes(e.evaluatorId));

    case "evaluations.evaluator_id.guardrails_only":
      return evaluations.some(
        (e) => evaluatorIds.includes(e.evaluatorId) && e.isGuardrail,
      );

    case "evaluations.evaluator_id.has_passed":
      return evaluations.some(
        (e) => evaluatorIds.includes(e.evaluatorId) && e.passed !== null,
      );

    case "evaluations.evaluator_id.has_score":
      return evaluations.some(
        (e) => evaluatorIds.includes(e.evaluatorId) && e.score !== null,
      );

    case "evaluations.evaluator_id.has_label":
      return evaluations.some(
        (e) =>
          evaluatorIds.includes(e.evaluatorId) &&
          e.label !== null &&
          e.label !== "",
      );

    default:
      return false;
  }
}

function matchEvaluationValues(
  evaluations: EvaluationRunData[],
  field: FilterField,
  values: string[],
): boolean {
  switch (field) {
    case "evaluations.passed":
      return evaluations.some(
        (e) => e.passed !== null && values.includes(String(e.passed)),
      );

    case "evaluations.score":
      return evaluations.some(
        (e) => e.score !== null && values.includes(String(e.score)),
      );

    case "evaluations.state":
      return evaluations.some((e) => values.includes(e.status));

    case "evaluations.label":
      return evaluations.some(
        (e) => e.label !== null && values.includes(e.label),
      );

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers (mirrored from evaluationTrigger.reactor.ts)
// ---------------------------------------------------------------------------

function parseJsonArray(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((l): l is string => typeof l === "string");
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

const RESERVED_PREFIXES = [
  "langwatch.",
  "gen_ai.",
  "metadata.sdk_",
  "metadata.telemetry_",
];
const RESERVED_KEYS = new Set([
  "metadata.thread_id",
  "metadata.user_id",
  "metadata.customer_id",
  "metadata.labels",
  "metadata.prompt_ids",
  "metadata.topic_id",
  "metadata.subtopic_id",
]);

function extractCustomMetadata(
  attrs: Record<string, string>,
): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith("metadata.")) continue;
    if (RESERVED_KEYS.has(key)) continue;
    if (RESERVED_PREFIXES.some((p) => key.startsWith(p))) continue;
    const customKey = key.slice("metadata.".length);
    if (customKey) {
      result[customKey] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
