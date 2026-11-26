/**
 * The filter values an analytics query cannot apply. Each translator falls back to no
 * predicate (or none that matches) when it recognises nothing, so these are refused before
 * any SQL is built instead of answering numbers that look filtered and are not.
 */
import type { FilterField, SeriesInput } from "@langwatch/analytics-contract";

/** The option values the options endpoint returns for a boolean field. */
export const BOOLEAN_FILTER_VALUES: readonly string[] = ["true", "false"];

/** Boolean fields, with the name the filter sidebar shows for each. */
const BOOLEAN_FILTER_NAMES: Partial<Record<FilterField, string>> = {
  "traces.error": "Contains Error",
  "annotations.hasAnnotation": "Annotations",
  "evaluations.passed": "Evaluation Passed",
};

/**
 * Keyed fields whose translation has nothing to match without the key, and the example of
 * the nested shape. Other keyed fields (`evaluations.passed` and its siblings, the event
 * keys) read a missing key as "across every evaluator or event" and stay accepted.
 */
const KEY_EXAMPLES: Partial<Record<FilterField, { depth: 1 | 2; example: string }>> = {
  "metadata.value": { depth: 1, example: '{"metadata.value":{"<metadataKey>":["<value>"]}}' },
  "events.metrics.value": {
    depth: 2,
    example: '{"events.metrics.value":{"<eventType>":{"<metricKey>":["<min>","<max>"]}}}',
  },
};

/** The first filter value a query cannot apply. */
export type UnapplicableFilter =
  | {
      kind: "unsupported_value";
      filterField: FilterField;
      filterName: string;
      received: string;
      accepted: readonly string[];
    }
  | { kind: "key_required"; filterField: FilterField; example: string };

/** A filter set as the timeseries input carries it, top-level or per series. */
type AnalyticsFilters = SeriesInput["filters"];

/** The string leaves of one field's value, with the depth each sits at. */
function leavesOf(value: unknown, depth = 0): { values: unknown[]; depth: number }[] {
  if (Array.isArray(value)) return value.length > 0 ? [{ values: value, depth }] : [];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((nested) => leavesOf(nested, depth + 1));
}

/** One field's first unapplicable value, at whichever nesting it was sent. */
export function findUnapplicableFilterValue({
  field,
  values,
  depth,
}: {
  field: FilterField;
  values: readonly unknown[];
  depth: number;
}): UnapplicableFilter | undefined {
  const filterName = BOOLEAN_FILTER_NAMES[field];
  if (filterName) {
    const received = values.find(
      (value) => typeof value !== "string" || !BOOLEAN_FILTER_VALUES.includes(value),
    );
    if (received !== undefined) {
      return {
        kind: "unsupported_value",
        filterField: field,
        filterName,
        received: typeof received === "string" ? received : JSON.stringify(received),
        accepted: BOOLEAN_FILTER_VALUES,
      };
    }
  }
  const keyed = KEY_EXAMPLES[field];
  if (keyed && depth < keyed.depth) {
    return { kind: "key_required", filterField: field, example: keyed.example };
  }
  return undefined;
}

/** The first unapplicable value across a whole filter set, walked the way the builders walk it. */
export function findUnapplicableFilter(filters: AnalyticsFilters): UnapplicableFilter | undefined {
  for (const [field, value] of Object.entries(filters ?? {})) {
    for (const leaf of leavesOf(value)) {
      const found = findUnapplicableFilterValue({
        field: field as FilterField,
        values: leaf.values,
        depth: leaf.depth,
      });
      if (found) return found;
    }
  }
  return undefined;
}
