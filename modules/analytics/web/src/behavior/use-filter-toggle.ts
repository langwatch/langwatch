/**
 * Whether the filter rail is open, and the count on its trigger.
 *
 * The `?show_filters=` half of `platform/app/src/components/filters/FilterToggle.tsx`.
 * The platform module stays: `components/checks/TryItOut.tsx` renders it too,
 * and deletes-only forbids repointing that one.
 *
 * A page whose rail is open BY DEFAULT writes `show_filters=false` to close it
 * and removes the key to open it, and a page whose rail is closed by default
 * does the opposite. That asymmetry is what keeps the default page address free
 * of a parameter that says what it already means.
 */

import { useCallback } from "react";

import { useAnalyticsHost } from "../model/analytics-host.ts";
import { useFilterParams } from "./use-filter-params.ts";

export function useFilterToggle({ defaultShowFilters = false } = {}) {
  const host = useAnalyticsHost();
  const { query } = host.route();
  const { filterParams, filterCount, hasAnyFilters, clearFilters, setNegateFilters } =
    useFilterParams();

  const showFilters =
    typeof query.show_filters === "string" ? query.show_filters === "true" : defaultShowFilters;

  const setShowFilters = useCallback(
    (show: boolean) => {
      const shownValue = defaultShowFilters ? void 0 : "true";
      const hiddenValue = defaultShowFilters ? "false" : void 0;
      const value = show ? shownValue : hiddenValue;
      host.setQuery({ ...host.route().query, show_filters: value });
    },
    [defaultShowFilters, host],
  );

  return {
    showFilters,
    setShowFilters,
    filterCount,
    hasAnyFilters,
    filterParams,
    clearFilters,
    setNegateFilters,
  };
}
