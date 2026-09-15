import {
  PRECONDITION_FIELD_MATCHERS,
  type AnalyticsFilterValue,
  type FilterField,
  type PreconditionFieldMatcher,
  type PreconditionTraceData,
} from "@langwatch/analytics-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";

/**
 * The legacy `filters` grammar, matched in memory (twin of `filters/clickhouse`).
 * Fail-closed (#4805): an unevaluable field forces NO-MATCH for the whole set —
 * skip-to-pass used to fire every such automation on every trace.
 */

/**
 * Fields that are only answerable once evaluations have run. Actionable here
 * means no-match; the caller routes them to `matchesEvaluationFilters`.
 */
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
 * Cannot positively evaluate: `metadata.key` (key-presence, not a precondition)
 * and `events.event_details.value` (a phantom field, matched nowhere).
 * `events.metrics.value` is absent on purpose — it matches as a numeric range.
 */
const UNSUPPORTED_FIELDS: ReadonlySet<string> = new Set([
  "metadata.key",
  "events.event_details.value",
]);

export class LegacyFilterMatchingService {
  static create(): LegacyFilterMatchingService {
    return new LegacyFilterMatchingService();
  }

  private constructor() {}

  matchesTraceFilters(input: {
    traceData: PreconditionTraceData;
    filters: Readonly<Record<string, unknown>>;
  }): boolean {
    for (const [field, filterValue] of Object.entries(input.filters) as [
      FilterField,
      AnalyticsFilterValue,
    ][]) {
      if (!filterValue) {
        continue;
      }

      const isUnmatchableField = EVALUATION_FIELDS.has(field) || UNSUPPORTED_FIELDS.has(field);
      if (isUnmatchableField) {
        if (hasActionableCondition(filterValue)) {
          return false;
        }

        continue;
      }

      if (!matchField(input.traceData, field, filterValue)) {
        return false;
      }
    }

    return true;
  }

  /**
   * The evaluation half, run once evaluations are read: `string[]` matches by
   * evaluator_id, keyed filters match a value per evaluator, and double-keyed
   * (`evaluations.score`) ignores the subkey since a run carries one score; fields AND.
   */
  matchesEvaluationFilters(input: {
    evaluations: EvaluationRunData[];
    filters: Readonly<Record<string, unknown>>;
  }): boolean {
    for (const [field, filterValue] of Object.entries(input.filters) as [
      FilterField,
      AnalyticsFilterValue,
    ][]) {
      if (!filterValue) {
        continue;
      }

      if (!EVALUATION_FIELDS.has(field)) {
        continue;
      }

      if (!matchEvaluationField(input.evaluations, field, filterValue)) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Whether a filter value has at least one non-empty (actionable) condition.
 * Empty arrays at any depth are vacuous, mirroring the ClickHouse builder.
 * Recursive, not depth-limited, so a deeper key-selector shape can't fool it.
 */
function hasActionableCondition(filterValue: unknown): boolean {
  if (Array.isArray(filterValue)) {
    return filterValue.length > 0;
  }

  if (typeof filterValue !== "object" || filterValue === null) {
    return false;
  }

  return Object.values(filterValue).some(hasActionableCondition);
}

/**
 * Matches a single filter field against trace data across three value shapes:
 * `string[]` (simple array), `Record<string, string[]>` (keyed), and
 * `Record<string, Record<string, string[]>>` (double-keyed).
 */
function matchField(
  traceData: PreconditionTraceData,
  field: FilterField,
  filterValue: AnalyticsFilterValue,
): boolean {
  // events.metrics.value is a numeric range, not membership — handle it with a
  // dedicated matcher that mirrors the ClickHouse range guards.
  if (field === "events.metrics.value") {
    return matchEventMetricRange(traceData, filterValue);
  }

  // Simple array: resolve field and check if any value matches
  if (Array.isArray(filterValue)) {
    if (filterValue.length === 0) {
      return true;
    }

    return matchSimpleArray(traceData, field, filterValue);
  }

  // Nested object: OR across keys (matches ClickHouse filter generation)
  let actionable = false;

  for (const [key, subValue] of Object.entries(filterValue)) {
    if (Array.isArray(subValue)) {
      // Record<string, string[]> — resolve with key
      if (subValue.length === 0) {
        continue;
      }

      actionable = true;
      if (matchSimpleArray(traceData, field, subValue, key)) {
        return true;
      }

      continue;
    }

    if (typeof subValue !== "object" || subValue === null) {
      continue;
    }

    // Record<string, Record<string, string[]>> — resolve with key + subkey
    for (const [subkey, values] of Object.entries(subValue)) {
      if (!Array.isArray(values)) {
        // Nesting deeper than key/subkey is a condition this matcher cannot
        // evaluate. Counting it as actionable makes the field fail closed: the
        // recursive save-time validation accepts the shape as "a condition",
        // so treating it as vacuous here would turn it into a match-everything
        // automation, the exact hole the validation closes.
        if (hasActionableCondition(values)) {
          actionable = true;
        }

        continue;
      }

      if (values.length === 0) {
        continue;
      }

      actionable = true;
      if (matchSimpleArray(traceData, field, values, key, subkey)) {
        return true;
      }
    }
  }

  return !actionable;
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
  const matcher: PreconditionFieldMatcher | null | undefined = PRECONDITION_FIELD_MATCHERS[field];

  // Key-selector fields (metadata.key) and unavailable fields
  if (!matcher) {
    return false;
  }

  const resolved = matcher(traceData, filterValues[0]!, key, subkey);

  if (resolved == null) {
    return false;
  }

  if (typeof resolved === "string") {
    return filterValues.includes(resolved);
  }

  if (Array.isArray(resolved)) {
    return resolved.some((v) => filterValues.includes(v));
  }

  return false;
}

/**
 * Matches `events.metrics.value`: double-keyed `{eventType: {metricKey: [min,
 * max]}}`, ORed across pairs, inclusive range. Mirrors the ClickHouse builder:
 * a malformed range contributes no match (never a vacuous pass); empty passes.
 */
function matchEventMetricRange(
  traceData: PreconditionTraceData,
  filterValue: AnalyticsFilterValue,
): boolean {
  // Defensive guard for an unreachable shape: events.metrics.value is always
  // double-keyed in production, never a bare array. An empty array is vacuous
  // (no conditions to fail); a non-empty bare array cannot be evaluated.
  if (Array.isArray(filterValue)) {
    return filterValue.length === 0;
  }

  const events = traceData.events;
  let matched = false;

  for (const [eventType, metricMap] of Object.entries(filterValue)) {
    if (typeof metricMap !== "object" || metricMap === null) {
      continue;
    }

    for (const [metricKey, values] of Object.entries(metricMap)) {
      if (!Array.isArray(values) || values.length === 0) {
        continue;
      }

      // A non-empty range is actionable. If it is malformed (fewer than two
      // values, non-numeric, or min > max) the ClickHouse builder emits `1=0`
      // (never matches); in-memory that means this condition cannot pass — it
      // must not skip to a vacuous pass, which would re-open the #4805
      // fire-on-everything hole. So mark it actionable and contribute no match.
      if (values.length < 2) {
        continue;
      }

      const min = parseFloat(values[0] ?? "");
      const max = parseFloat(values[1] ?? "");
      const isValidRange = Number.isFinite(min) && Number.isFinite(max) && min <= max;
      if (!isValidRange) {
        continue;
      }

      if (matchesMetricRange({ events, eventType, metricKey, min, max })) {
        matched = true;
        break;
      }
    }

    if (matched) {
      break;
    }
  }

  // No actionable range → vacuous (pass). Actionable ranges present but none
  // matched → no match. Reuse the shared predicate for a single source of truth.
  return matched || !hasActionableCondition(filterValue);
}

function matchesMetricRange(input: {
  events: PreconditionTraceData["events"];
  eventType: string;
  metricKey: string;
  min: number;
  max: number;
}): boolean {
  return (input.events ?? []).some(
    (event) =>
      event.event_type === input.eventType &&
      event.metrics.some(
        (metric) =>
          metric.key === input.metricKey && metric.value >= input.min && metric.value <= input.max,
      ),
  );
}

function matchEvaluationField(
  evaluations: EvaluationRunData[],
  field: FilterField,
  filterValue: AnalyticsFilterValue,
): boolean {
  // Simple array filters: evaluations.evaluator_id and variants
  if (Array.isArray(filterValue)) {
    if (filterValue.length === 0) {
      return true;
    }

    return matchEvaluatorIdFilter(evaluations, field, filterValue);
  }

  // Keyed filters: evaluations.passed, evaluations.state, evaluations.label, evaluations.score
  for (const [evaluatorId, subValue] of Object.entries(filterValue)) {
    const forEvaluator = evaluations.filter((e) => e.evaluatorId === evaluatorId);
    if (forEvaluator.length === 0) {
      return false;
    }

    if (Array.isArray(subValue)) {
      // Record<string, string[]> — e.g., evaluations.passed: { "eval-1": ["true"] }
      if (subValue.length === 0) {
        continue;
      }

      if (!matchEvaluationValues(forEvaluator, field, subValue)) {
        return false;
      }

      continue;
    }

    if (typeof subValue !== "object" || subValue === null) {
      continue;
    }

    // Record<string, Record<string, string[]>> — evaluations.score:
    // { "eval-1": { "score": ["0.5"] } }
    for (const [, values] of Object.entries(subValue)) {
      if (!Array.isArray(values) || values.length === 0) {
        continue;
      }

      if (!matchEvaluationValues(forEvaluator, field, values)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * A verdict is only real once the evaluation completed — `passed: false` can
 * accompany `status: "error"`, so without this guard "passed = false" pages
 * for what is actually a provider timeout (#6833); use `evaluations.state` instead.
 */
function hasVerdict(e: EvaluationRunData): boolean {
  return e.status === "processed";
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
      return evaluations.some((e) => evaluatorIds.includes(e.evaluatorId) && e.isGuardrail);

    case "evaluations.evaluator_id.has_passed":
      return evaluations.some(
        (e) => evaluatorIds.includes(e.evaluatorId) && hasVerdict(e) && e.passed !== null,
      );

    case "evaluations.evaluator_id.has_score":
      return evaluations.some(
        (e) => evaluatorIds.includes(e.evaluatorId) && hasVerdict(e) && e.score !== null,
      );

    case "evaluations.evaluator_id.has_label":
      return evaluations.some(
        (e) =>
          evaluatorIds.includes(e.evaluatorId) &&
          hasVerdict(e) &&
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
        (e) => hasVerdict(e) && e.passed !== null && values.includes(String(e.passed)),
      );

    case "evaluations.score":
      return evaluations.some(
        (e) => hasVerdict(e) && e.score !== null && values.includes(String(e.score)),
      );

    case "evaluations.state":
      return evaluations.some((e) => values.includes(e.status));

    case "evaluations.label":
      return evaluations.some((e) => hasVerdict(e) && e.label !== null && values.includes(e.label));

    default:
      return false;
  }
}
