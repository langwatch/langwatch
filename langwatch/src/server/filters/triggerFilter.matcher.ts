import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
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

/**
 * Fields the in-memory matcher cannot positively evaluate at trace time
 * (key-selectors and phantom value fields). A NON-EMPTY actionable condition on
 * one of these forces NO-MATCH for the whole filter set — it must never
 * silently skip-to-pass, which made every such automation fire on every trace
 * (issue #4805).
 *
 * - `metadata.key`: a key-presence selector, not a standalone precondition.
 * - `events.event_details.value`: a phantom field — not in the filter registry
 *   or the ClickHouse builder — so it can never match; treat as unevaluable.
 *
 * `events.metrics.value` is intentionally NOT here: it is now matched in-memory
 * as an inclusive numeric range (mirroring the ClickHouse builder).
 */
const UNSUPPORTED_FIELDS: ReadonlySet<string> = new Set([
  "metadata.key",
  "events.event_details.value",
]);

/**
 * Event filter fields that ARE matched in-memory and therefore need the
 * trace-level events list. Reactors gate event derivation on this set, so any
 * field matched against `traceData.events` must be listed here.
 */
const MATCHABLE_EVENT_FILTER_FIELDS: ReadonlySet<string> = new Set([
  "events.event_type",
  "events.metrics.key",
  "events.metrics.value",
  "events.event_details.key",
]);

/**
 * Whether any of these filters match on event fields that need the trace-level
 * events list. Reactors use this to derive events from stored_spans only when a
 * trigger actually filters on them, keeping the common path off the read.
 */
export function triggerFiltersReferenceEvents(
  filters: TriggerFilters,
): boolean {
  return Object.keys(filters).some((field) =>
    MATCHABLE_EVENT_FILTER_FIELDS.has(field),
  );
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
 * Converts TraceSummaryData (fold state) into PreconditionTraceData for
 * in-memory filter matching. Extracts structured fields from the flat
 * attributes map, mirroring the logic in evaluationTrigger.reactor.ts.
 *
 * The trace-level events list is no longer carried on the fold state; callers
 * that match event filters pass it in (derived from stored_spans, gated by
 * `triggerFiltersReferenceEvents`). Omitting it leaves event filters unmatched.
 */
export function buildPreconditionTraceDataFromFoldState(
  foldState: TraceSummaryData,
  events?: DerivedTraceEvent[] | null,
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
    events: buildPreconditionEvents(events),
  };
}

function buildPreconditionEvents(
  events: DerivedTraceEvent[] | null | undefined,
): PreconditionTraceData["events"] {
  if (!events || events.length === 0) return null;

  return events.map((e) => {
    const metrics: Array<{ key: string; value: number }> = [];
    const eventDetails: Array<{ key: string; value: string }> = [];

    for (const [key, value] of Object.entries(e.attributes)) {
      if (key.startsWith("event.metrics.")) {
        const metricKey = key.slice("event.metrics.".length);
        const num = Number(value);
        if (metricKey && Number.isFinite(num)) {
          metrics.push({ key: metricKey, value: num });
        }
      } else if (key.startsWith("event.details.")) {
        const detailKey = key.slice("event.details.".length);
        if (detailKey) {
          eventDetails.push({ key: detailKey, value });
        }
      }
    }

    return {
      event_type: e.name,
      metrics,
      event_details: eventDetails,
    };
  });
}

/**
 * Evaluates trigger filters in-memory against trace data.
 *
 * Semantics match the ClickHouse query builder:
 * - Within a field: OR (any filter value matches → field passes)
 * - Across fields: AND (all fields must pass)
 *
 * Fail-closed (issue #4805): a filter set passes ONLY when every actionable
 * condition positively matched. An actionable (non-empty) condition on a field
 * the in-memory matcher cannot positively evaluate — an evaluation field, an
 * UNSUPPORTED_FIELDS key-selector, or any value the matcher rejects — forces
 * NO-MATCH for the whole set. Empty-array conditions stay vacuous (they pass),
 * so a filter set with no actionable conditions at all still returns true.
 *
 * Evaluation fields here return false for the whole trigger when actionable;
 * the caller should use classifyTriggerFilters to route them first.
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

    // A non-empty condition on a field we cannot positively evaluate
    // (evaluation field or unsupported key-selector/phantom field) must NOT
    // skip-to-pass — that is the #4805 fire-on-everything defect. Empty
    // conditions are vacuous and skipped.
    if (EVALUATION_FIELDS.has(field) || UNSUPPORTED_FIELDS.has(field)) {
      if (filterValueHasActionableCondition(filterValue)) return false;
      continue;
    }

    if (!matchField(traceData, field, filterValue)) {
      return false;
    }
  }

  return true;
}

/**
 * Whether a filter value carries at least one non-empty (actionable) condition.
 * Empty arrays — at any nesting depth — are vacuous and do not constrain the
 * match, mirroring the ClickHouse builder which emits no SQL for them.
 */
function filterValueHasActionableCondition(
  filterValue: TriggerFilterValue,
): boolean {
  if (Array.isArray(filterValue)) {
    return filterValue.length > 0;
  }

  for (const subValue of Object.values(filterValue)) {
    if (Array.isArray(subValue)) {
      if (subValue.length > 0) return true;
    } else if (typeof subValue === "object" && subValue !== null) {
      for (const values of Object.values(subValue)) {
        if (Array.isArray(values) && values.length > 0) return true;
      }
    }
  }

  return false;
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
  // events.metrics.value is a numeric range, not membership — handle it with a
  // dedicated matcher that mirrors the ClickHouse range guards.
  if (field === "events.metrics.value") {
    return matchEventMetricRange(traceData, filterValue);
  }

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
 * Matches the `events.metrics.value` numeric-range filter in-memory.
 *
 * The filter value is double-keyed: `{ [eventType]: { [metricKey]: [min, max] } }`.
 * OR across every event-type / metric-key pair. A pair matches iff some event of
 * that type carries a metric with that key whose value is within the inclusive
 * `[min, max]` range.
 *
 * Mirrors the ClickHouse builder (`filter-conditions.ts` → "events.metrics.value")
 * exactly: a range needs >= 2 values, both parse as finite numbers, and min <= max;
 * any range failing those guards contributes no match (matches the CH `1=0`).
 * With no actionable (non-empty) range, the condition is vacuous and passes.
 */
function matchEventMetricRange(
  traceData: PreconditionTraceData,
  filterValue: TriggerFilterValue,
): boolean {
  // A bare array shape is not how this double-keyed field is ever produced;
  // an empty/array value is vacuous, anything else cannot be evaluated.
  if (Array.isArray(filterValue)) {
    return filterValue.length === 0;
  }

  const events = traceData.events;
  let hasActionableCondition = false;

  for (const [eventType, metricMap] of Object.entries(filterValue)) {
    if (typeof metricMap !== "object" || metricMap === null) continue;

    for (const [metricKey, values] of Object.entries(metricMap)) {
      if (!Array.isArray(values) || values.length === 0) continue;

      // A non-empty range is actionable. If it is malformed (fewer than two
      // values, non-numeric, or min > max) the CH builder emits `1=0` (never
      // matches); in-memory that means this condition cannot pass — it must not
      // skip-to-vacuous-pass, which would re-open the #4805 fire-on-everything
      // hole. So mark it actionable and contribute no match.
      hasActionableCondition = true;

      if (values.length < 2) continue;

      const min = parseFloat(values[0] ?? "");
      const max = parseFloat(values[1] ?? "");
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        continue;
      }

      const matched = (events ?? []).some(
        (event) =>
          event.event_type === eventType &&
          event.metrics.some(
            (metric) =>
              metric.key === metricKey &&
              metric.value >= min &&
              metric.value <= max,
          ),
      );
      if (matched) return true;
    }
  }

  // No actionable range → vacuous (pass). Actionable ranges present but none
  // matched → no match.
  return !hasActionableCondition;
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

/**
 * Bare-key prefixes that are standard OTEL/system attributes, not custom metadata.
 * Only used when resolving bare (unprefixed) attribute keys.
 */
const BARE_KEY_EXCLUDED_PREFIXES = [
  "service.",
  "telemetry.",
  "http.",
  "rpc.",
  "db.",
  "net.",
  "host.",
  "os.",
  "process.",
  "container.",
  "k8s.",
  "cloud.",
  "faas.",
  "url.",
  "server.",
  "client.",
  "otel.",
];

function resolveCustomMetadataKey(key: string): {
  customKey: string;
  priority: number;
} | null {
  // Priority 3: canonical "metadata.{key}" (from Python SDK canonicalization)
  if (key.startsWith("metadata.")) {
    if (RESERVED_KEYS.has(key)) return null;
    if (RESERVED_PREFIXES.some((p) => key.startsWith(p))) return null;
    const customKey = key.slice("metadata.".length);
    return customKey ? { customKey, priority: 3 } : null;
  }

  // Priority 2: legacy "langwatch.metadata.{key}" (legacy REST collector)
  if (key.startsWith("langwatch.metadata.")) {
    const customKey = key.slice("langwatch.metadata.".length);
    return customKey ? { customKey, priority: 2 } : null;
  }

  // Skip all other known prefixes
  if (RESERVED_PREFIXES.some((p) => key.startsWith(p))) return null;
  if (BARE_KEY_EXCLUDED_PREFIXES.some((p) => key.startsWith(p))) return null;

  // Priority 1: bare OTEL resource attribute (legacy)
  if (key.length === 0) return null;
  return { customKey: key, priority: 1 };
}

/**
 * Extracts custom metadata from fold state attributes.
 * Matches all three legacy key formats consistent with ClickHouse filter generation:
 * - metadata.{key} (canonical, priority 3)
 * - langwatch.metadata.{key} (legacy REST, priority 2)
 * - {key} (bare OTEL attribute, priority 1)
 */
function extractCustomMetadata(
  attrs: Record<string, string>,
): Record<string, string> | null {
  const result: Record<string, string> = {};
  const priorities: Record<string, number> = {};

  for (const [key, value] of Object.entries(attrs)) {
    const resolved = resolveCustomMetadataKey(key);
    if (!resolved) continue;

    const currentPriority = priorities[resolved.customKey] ?? 0;
    if (resolved.priority <= currentPriority) continue;

    priorities[resolved.customKey] = resolved.priority;
    result[resolved.customKey] = value;
  }

  return Object.keys(result).length > 0 ? result : null;
}
