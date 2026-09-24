/**
 * What the address says the charts are filtered to. Deliberately missing:
 * the saved-view fallback — a governed screen can't touch browser storage,
 * and has no `SavedViewsBar` chrome above it to read one from anyway.
 */

import { availableFilters } from "./analytics-filter-catalogue.ts";
import type { FilterField } from "./analytics-filter-definition.ts";

/** One filter's value: a list, a keyed list, or a keyed-and-subkeyed list. */
export type FilterParam =
  | string[]
  | Record<string, string[]>
  | Record<string, Record<string, string[]>>;

/**
 * The filters with nothing selected removed — a SHALLOW check on the
 * nested shapes, on purpose: `{ "eval-1": [] }` means "key picked, values
 * still coming," which the nested editor needs kept.
 */
export const filterOutEmptyFilters = (
  filters: Partial<Record<FilterField, FilterParam | string>> | undefined,
): Record<FilterField, FilterParam> => {
  if (!filters) return {} as Record<FilterField, FilterParam>;
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === "string") return !!value;
      if (Array.isArray(value)) return value.length > 0;
      return Object.keys(value).length > 0;
    }),
  ) as Record<FilterField, FilterParam>;
};

const normalise = (value: FilterParam, dropEmpty: boolean): FilterParam => {
  if (Array.isArray(value)) return value.filter((entry) => entry !== "");

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]): [string, FilterParam][] => {
      if (Array.isArray(nested)) {
        const kept = nested.filter((entry) => entry !== "");
        if (dropEmpty && kept.length === 0) return [];
        return [[key, kept]];
      }
      if (nested && typeof nested === "object") {
        const kept = normalise(nested, dropEmpty);
        if (dropEmpty && Object.keys(kept).length === 0) return [];
        return [[key, kept]];
      }
      return [[key, [nested]]];
    }),
  ) as FilterParam;
};

/** The filters the parsed query string names, by field rather than by URL key. */
export const readFiltersFromQuery = (
  queryParams: Readonly<Record<string, unknown>>,
): Partial<Record<FilterField, FilterParam>> => {
  const filters: Partial<Record<FilterField, FilterParam>> = {};
  for (const [field, definition] of Object.entries(availableFilters)) {
    const param = queryParams[definition.urlKey];
    if (!param) continue;
    const asParam = typeof param === "string" ? [param] : (param as FilterParam);
    filters[field as FilterField] = normalise(asParam, false);
  }
  return filters;
};

/** Whether the reader has narrowed anything at all. */
export const countFilters = (filters: Partial<Record<FilterField, FilterParam>> | undefined) => {
  const nonEmptyFilters = filterOutEmptyFilters(filters);
  const filterCount = Object.keys(nonEmptyFilters).length;
  return { nonEmptyFilters, filterCount, hasAnyFilters: filterCount > 0 };
};

/** Every query key that belongs to a filter, so a clear can drop exactly those. */
export const isFilterQueryKey = (key: string): boolean =>
  Object.values(availableFilters).some(
    (definition) => key === definition.urlKey || key.startsWith(`${definition.urlKey}.`),
  );
