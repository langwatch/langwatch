/**
 * Binds `useFilterParams`'s pure model to the address: `enabled` avoids
 * firing before a project resolves; refetch-on-mount/focus stay off since
 * every read here is a one-shot ClickHouse aggregate.
 */

import { URL_QS_PARSE_OPTIONS } from "@langwatch/analytics-browser-kit";
import qs from "qs";
import { useCallback, useMemo } from "react";

import { availableFilters } from "../model/analytics-filter-catalogue.ts";
import type { FilterField } from "../model/analytics-filter-definition.ts";
import {
  countFilters,
  isFilterQueryKey,
  readFiltersFromQuery,
  type FilterParam,
} from "../model/analytics-filter-params.ts";
import { useAnalyticsHost } from "../model/analytics-host.ts";
import type { AnalyticsReadScope } from "./analytics-api.ts";
import { useAnalyticsPeriod } from "./use-analytics-period.ts";

/**
 * How this family writes a query string: `allowEmptyArrays` is a real
 * `qs` option its published types omit (suppressed before with a
 * `@ts-ignore`); widening to `IStringifyOptions` fixes the type honestly.
 */
const QS_WRITE_OPTIONS: qs.IStringifyOptions & { allowEmptyArrays?: boolean } = {
  allowDots: true,
  arrayFormat: "comma" as const,
  allowEmptyArrays: true,
};

/**
 * `qs` nests the address's filters: `evaluations.score` arrives as
 * `?evaluation_score.<evaluatorId>=0.8`, and only a dot/comma-aware parser
 * turns that into the two-level record the procedures take.
 */
function parseQuery(query: Readonly<Record<string, string | undefined>>) {
  const present = Object.entries(query).filter(
    (entry): entry is [string, string] => entry[1] !== void 0,
  );
  const encoded = qs.stringify(Object.fromEntries(present), QS_WRITE_OPTIONS);
  return qs.parse(encoded.replaceAll("%2C", ","), URL_QS_PARSE_OPTIONS);
}

export function useFilterParams() {
  const host = useAnalyticsHost();
  const project = host.project();
  const { query } = host.route();
  const {
    period: { startDate, endDate },
  } = useAnalyticsPeriod();

  const queryParams = useMemo(() => parseQuery(query), [query]);
  const filters = useMemo(() => readFiltersFromQuery(queryParams), [queryParams]);

  /**
   * A keyset cursor describes a position in the PREVIOUS result set; carrying
   * it across a filter change would resume the new list partway down, so the
   * first matching rows are never shown. Dropping it returns to the first page.
   */
  const writeQuery = useCallback(
    (next: Record<string, unknown>) => {
      const { scrollId: _dropped, ...kept } = next;
      const flattened = qs.parse(qs.stringify(kept, QS_WRITE_OPTIONS), URL_QS_PARSE_OPTIONS);
      const encoded = qs.stringify(flattened, QS_WRITE_OPTIONS);
      const asPairs = Object.fromEntries(
        encoded
          .split("&")
          .filter(Boolean)
          .map((pair) => {
            const separator = pair.indexOf("=");
            const key = separator < 0 ? pair : pair.slice(0, separator);
            const value = separator < 0 ? "" : pair.slice(separator + 1);
            return [decodeURIComponent(key), decodeURIComponent(value)];
          }),
      );
      host.setQuery(asPairs);
    },
    [host],
  );

  const setFilter = useCallback(
    (field: FilterField, params: FilterParam) => {
      const urlKey = availableFilters[field].urlKey;
      writeQuery({
        ...Object.fromEntries(
          Object.entries(queryParams).filter(
            ([key]) => key !== urlKey && !key.startsWith(`${urlKey}.`),
          ),
        ),
        [urlKey]: params,
      });
    },
    [queryParams, writeQuery],
  );

  const setFilters = useCallback(
    (filtersToSet: Partial<Record<FilterField, FilterParam>>) => {
      writeQuery({
        ...Object.fromEntries(
          Object.entries(queryParams).filter(([key]) => !isFilterQueryKey(key)),
        ),
        ...Object.fromEntries(
          Object.entries(filtersToSet).map(([field, params]) => [
            availableFilters[field as FilterField].urlKey,
            params,
          ]),
        ),
      });
    },
    [queryParams, writeQuery],
  );

  const clearFilters = useCallback(() => {
    writeQuery(
      Object.fromEntries(
        Object.entries(queryParams).filter(([key]) => key !== "query" && !isFilterQueryKey(key)),
      ),
    );
  }, [queryParams, writeQuery]);

  const setNegateFilters = useCallback(
    (negateFilters: boolean) => {
      writeQuery({ ...queryParams, negateFilters: negateFilters ? "true" : "false" });
    },
    [queryParams, writeQuery],
  );

  const filterParams: AnalyticsReadScope = useMemo(
    () => ({
      projectId: project?.id ?? "",
      startDate: startDate.epochMilliseconds,
      endDate: endDate.epochMilliseconds,
      filters,
      ...(typeof queryParams.query === "string" ? { query: queryParams.query } : {}),
      ...(queryParams.negateFilters === "true" ? { negateFilters: true } : {}),
    }),
    [project?.id, startDate, endDate, filters, queryParams.query, queryParams.negateFilters],
  );

  const { nonEmptyFilters, filterCount, hasAnyFilters } = countFilters(filters);

  return {
    filters,
    setFilter,
    setFilters,
    clearFilters,
    setNegateFilters,
    filterParams,
    getLatestFilters: () => filterParams,
    nonEmptyFilters,
    filterCount,
    hasAnyFilters,
    queryOpts: {
      enabled: !!project,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      trpc: { context: { skipBatch: true } },
    },
  };
}
