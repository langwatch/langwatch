import type { FilterParam } from "../../hooks/useFilterParams";
import type { FilterField } from "../filters/types";

export const filterOutEmptyFilters = (
  filters: Partial<Record<FilterField, FilterParam | string>> | undefined,
): Record<FilterField, FilterParam> => {
  if (!filters) {
    return {} as Record<FilterField, FilterParam>;
  }
  return Object.fromEntries(
    Object.entries(filters).filter(([_, f]) => {
      if (f == null) return false;
      if (typeof f === "string") return !!f;
      if (Array.isArray(f)) return f.length > 0;
      // Shallow check: keep objects with keys even if leaf arrays are empty.
      // { "eval-1": [] } means "key selected, sub-values pending" and must
      // be preserved so the nested filter UI can render the sub-options.
      return Object.keys(f).length > 0;
    }),
  ) as Record<FilterField, FilterParam>;
};

// Recursively checks whether a filter value has any non-empty leaf arrays,
// meaning it would actually produce query conditions.
const hasActiveConditions = (value: FilterParam | string): boolean => {
  if (typeof value === "string") return !!value;
  if (Array.isArray(value)) return value.length > 0;
  return Object.values(value).some((v) => hasActiveConditions(v));
};

/**
 * Counts filters that have actual query conditions (non-empty leaf arrays).
 * Use this for badge counts instead of filterOutEmptyFilters which is
 * intentionally shallow to preserve intermediate UI state like
 * "evaluator selected, sub-option pending".
 */
export const countActiveFilters = (
  filters: Partial<Record<FilterField, FilterParam | string>> | undefined,
): number => {
  if (!filters) return 0;
  return Object.values(filters).filter(
    (f) => f != null && hasActiveConditions(f),
  ).length;
};
