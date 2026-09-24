import {
  PRECONDITION_FIELD_MATCHERS,
  type AnalyticsFilterValue,
  type FilterField,
  type PreconditionFieldMatcher,
  type PreconditionTraceData,
} from "@langwatch/analytics-contract";
import type { DerivedTraceEvent, TraceSummaryData } from "@langwatch/trace-contract";

import type { PreconditionTraceDataService } from "./precondition-trace-data.service.ts";

/**
 * The legacy `filters` grammar, matched in memory (twin of `filters/clickhouse`).
 * Fail-closed (#4805): an unevaluable field forces NO-MATCH for the whole set —
 * skip-to-pass used to fire every such automation on every trace.
 */

/**
 * Fields that are only answerable once evaluations have run. Actionable here
 * means no-match; the caller routes them to `EvaluationApi.matchesEvaluationFilters`.
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
  static create({
    preconditionTraceData,
  }: {
    preconditionTraceData: PreconditionTraceDataService;
  }): LegacyFilterMatchingService {
    return new LegacyFilterMatchingService(preconditionTraceData);
  }

  private constructor(private readonly preconditionTraceData: PreconditionTraceDataService) {}

  /** The trace half of a trigger's legacy filters against the fold state it settled on. */
  matchesTraceFilters(input: {
    filters: Readonly<Record<string, unknown>>;
    foldState: TraceSummaryData;
    events: DerivedTraceEvent[] | null;
  }): boolean {
    return this.matchesTraceData({
      traceData: this.preconditionTraceData.fromFoldState({
        foldState: input.foldState,
        events: input.events,
      }),
      filters: input.filters,
    });
  }

  matchesTraceData(input: {
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

    return matchSimpleArray({ traceData, field, filterValues: filterValue });
  }

  let actionable = false;

  for (const [key, subValue] of Object.entries(filterValue)) {
    const result = matchKeyedTraceField({ traceData, field, key, subValue });
    if (result === "matched") {
      return true;
    }
    actionable ||= result === "unmatched";
  }

  return !actionable;
}

function matchKeyedTraceField({
  traceData,
  field,
  key,
  subValue,
}: {
  traceData: PreconditionTraceData;
  field: FilterField;
  key: string;
  subValue: string[] | Record<string, string[]>;
}): "matched" | "unmatched" | "empty" {
  if (Array.isArray(subValue)) {
    if (subValue.length === 0) {
      return "empty";
    }
    return matchSimpleArray({ traceData, field, filterValues: subValue, key })
      ? "matched"
      : "unmatched";
  }

  if (typeof subValue !== "object" || subValue === null) {
    return "empty";
  }

  let actionable = false;
  for (const [subkey, values] of Object.entries(subValue)) {
    // Deeper conditions are actionable but cannot match this two-key grammar.
    // Treating them as empty would turn a malformed filter into match-everything.
    actionable ||= hasActionableCondition(values);
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }
    if (matchSimpleArray({ traceData, field, filterValues: values, key, subkey })) {
      return "matched";
    }
  }

  return actionable ? "unmatched" : "empty";
}

/**
 * Resolves a field value using the precondition matcher registry and
 * checks if any of the filter values match.
 */
function matchSimpleArray({
  traceData,
  field,
  filterValues,
  key,
  subkey,
}: {
  traceData: PreconditionTraceData;
  field: FilterField;
  filterValues: string[];
  key?: string;
  subkey?: string;
}): boolean {
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

  const matched = Object.entries(filterValue).some(([eventType, metricMap]) =>
    matchEventMetricMap(traceData.events, eventType, metricMap),
  );

  return matched || !hasActionableCondition(filterValue);
}

function matchEventMetricMap(
  events: PreconditionTraceData["events"],
  eventType: string,
  metricMap: string[] | Record<string, string[]>,
): boolean {
  if (typeof metricMap !== "object" || metricMap === null) {
    return false;
  }

  for (const [metricKey, values] of Object.entries(metricMap)) {
    if (!Array.isArray(values) || values.length < 2) {
      continue;
    }

    const min = parseFloat(values[0] ?? "");
    const max = parseFloat(values[1] ?? "");
    const isValidRange = Number.isFinite(min) && Number.isFinite(max) && min <= max;
    if (!isValidRange) {
      continue;
    }

    if (matchesMetricRange({ events, eventType, metricKey, min, max })) {
      return true;
    }
  }

  return false;
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
