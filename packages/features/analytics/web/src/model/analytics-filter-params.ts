/**
 * What the address says the charts are filtered to.
 *
 * The reading half of `platform/app/src/hooks/useFilterParams.ts` and all of
 * `platform/app/src/server/analytics/utils.ts`, made pure: a query string in,
 * the filter record every analytics procedure takes out. Twenty-odd platform
 * modules still read the hook, so the platform copy stays and this is the
 * family's own — narrowed by everything below.
 *
 * WHAT DID NOT TRAVEL, and it is deliberate: the saved-view fallback. The
 * platform hook, finding no filter in the address, read a view id and a cached
 * view out of `localStorage` and filtered by it. A governed screen may not
 * touch browser storage, and there is nothing for it to read anyway — the bar
 * that writes those keys is `DashboardPageBody`'s `SavedViewsBar`, application
 * chrome a screen served from `apps/ui` has nothing above it to supply. The
 * annotations family recorded the same loss on `/annotations/all`; here the
 * mode was not merely unreachable, it was unreachable AND unwritable.
 */

import { availableFilters } from "./analytics-filter-catalogue";
import type { FilterField } from "./analytics-filter-definition";

/** One filter's value: a list, a keyed list, or a keyed-and-subkeyed list. */
export type FilterParam =
  | string[]
  | Record<string, string[]>
  | Record<string, Record<string, string[]>>;

/**
 * The filters with nothing selected removed.
 *
 * A SHALLOW check on the nested shapes, on purpose: `{ "eval-1": [] }` means
 * "key picked, values still coming" and the nested editor needs it kept.
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
      return [[key, [nested as unknown as string]]];
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
