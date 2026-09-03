import {
  PRECONDITION_FIELD_MATCHERS,
  type AnalyticsFilterValue,
  type FilterField,
  type PreconditionFieldMatcher,
  type PreconditionTraceData,
} from "@langwatch/analytics-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";

/**
 * The legacy `filters` grammar, decided in memory instead of in ClickHouse.
 *
 * Automations written before the LangWatchQL migration carry a `filters` map
 * rather than a query, and a settled match has to be re-checked against the
 * trace it settled on — with no query engine to hand it to. This is that
 * check, and it is the in-memory twin of `filters/clickhouse`: the same
 * within-field OR, the same across-field AND, the same numeric-range guards on
 * `events.metrics.value`. The two have to agree, because one of them decides
 * which traces a customer SEES and the other decides which ones page them.
 *
 * Fail-closed is the whole design (issue #4805). A filter set passes only when
 * every actionable condition positively matched. A non-empty condition on a
 * field this matcher cannot positively evaluate — an evaluation field at trace
 * time, a key selector, a phantom field, a shape nested deeper than the
 * grammar — forces NO-MATCH for the whole set rather than skipping to pass.
 * Skipping to pass is what made every such automation fire on every trace.
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
 * Fields this matcher cannot positively evaluate at trace time.
 *
 * - `metadata.key`: a key-presence selector, not a standalone precondition.
 * - `events.event_details.value`: a phantom field — in neither the filter
 *   registry nor the ClickHouse builder — so it can never match.
 *
 * `events.metrics.value` is deliberately NOT here: it is matched as an
 * inclusive numeric range, mirroring the ClickHouse builder.
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

      if (EVALUATION_FIELDS.has(field) || UNSUPPORTED_FIELDS.has(field)) {
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
   * The evaluation half, run once the trace's evaluations have been read.
   *
   * - evaluator_id filters (`string[]`): some evaluation names a listed id.
   * - keyed filters (`Record<evaluatorId, string[]>`): for each evaluator id,
   *   some evaluation of that evaluator carries a listed value.
   * - double-keyed filters (`evaluations.score`): the same, subkey ignored,
   *   because a run carries a single score.
   * - across fields: AND.
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
 * Whether a filter value carries at least one non-empty (actionable) condition.
 * Empty arrays — at any nesting depth — are vacuous and do not constrain the
 * match, mirroring the ClickHouse builder which emits no SQL for them.
 *
 * Recursive rather than depth-limited so it cannot be fooled by a shape one
 * level deeper than whatever the key selectors happen to nest today.
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
 * Matches a single filter field against trace data.
 * Handles three filter value shapes:
 *   - string[] — simple array (e.g., "spans.model": ["gpt-4", "gpt-5-mini"])
 *   - Record<string, string[]> — keyed (e.g., "metadata.value": { "env": ["prod"] })
 *   - Record<string, Record<string, string[]>> — double-keyed
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
 * Matches the `events.metrics.value` numeric-range filter in-memory.
 *
 * The filter value is double-keyed: `{ [eventType]: { [metricKey]: [min, max] } }`.
 * OR across every event-type / metric-key pair. A pair matches iff some event of
 * that type carries a metric with that key whose value is within the inclusive
 * `[min, max]` range.
 *
 * Mirrors the ClickHouse builder (`filters/clickhouse/filter-conditions.ts` →
 * "events.metrics.value") exactly: a range needs >= 2 values, both parse as
 * finite numbers, and min <= max; any range failing those guards contributes no
 * match (matching the ClickHouse `1=0`). With no actionable (non-empty) range,
 * the condition is vacuous and passes.
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
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
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

    // Record<string, Record<string, string[]>> — evaluations.score: { "eval-1": { "score": ["0.5"] } }
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
 * A verdict (passed/score) is only real when the evaluation ran to
 * completion. Producers can attach `passed: false` alongside `status:
 * "error"` (the SDKs expose them as independent params), and the run feed is
 * unfiltered — without this guard a trigger configured as "evaluations.passed
 * = false" pages someone for a quality regression that is actually a
 * provider timeout (#6833). Status-based filters (`evaluations.state`) are
 * the intended way to alert on errored evaluators.
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
