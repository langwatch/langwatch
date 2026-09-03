/**
 * What every chart on these pages is narrowed to, read off the address.
 *
 * The binding half of `platform/app/src/hooks/useFilterParams.ts`: the reading
 * and the writing are pure in `model/analytics-filter-params.ts`, and this is
 * the seam that gives them the address and the range.
 *
 * `queryOpts` travels unchanged because it is load-bearing three times over.
 * `enabled` keeps a read from firing before a project resolves or with an
 * unparseable date — the two ways a chart used to ask for `projectId: ""`,
 * which reads as a wiring bug at ERROR. `refetchOnMount` and
 * `refetchOnWindowFocus` are both off because an analytics page is read, not
 * watched, and every one of these reads is a ClickHouse aggregate.
 * `skipBatch` keeps one slow series off the other eleven: batched, a
 * thirty-second percentile query holds up every chart on the page.
 */

import { useCallback, useMemo } from "react";
import qs from "qs";

import { useAnalyticsHost } from "../model/analytics-host";
import { availableFilters } from "../model/analytics-filter-catalogue";
import type { FilterField } from "../model/analytics-filter-definition";
import {
  countFilters,
  isFilterQueryKey,
  readFiltersFromQuery,
  type FilterParam,
} from "../model/analytics-filter-params";
import { URL_QS_PARSE_OPTIONS } from "../model/qs-parse-options";
import { useAnalyticsPeriod } from "./use-analytics-period";
import type { AnalyticsReadScope } from "./analytics-api";

/**
 * How this family writes a query string.
 *
 * `allowEmptyArrays` is a real `qs` option that its published types do not
 * declare; the application suppressed the error with a `@ts-ignore` and a
 * shrug. Widening the literal to `IStringifyOptions` says the same thing to the
 * compiler without disabling a line of it.
 */
const QS_WRITE_OPTIONS: qs.IStringifyOptions & { allowEmptyArrays?: boolean } = {
  allowDots: true,
  arrayFormat: "comma" as const,
  allowEmptyArrays: true,
};

/**
 * The address's filters, as a nested structure rather than as flat keys.
 *
 * `qs` is what does the nesting: a filter like `evaluations.score` arrives as
 * `?evaluation_score.<evaluatorId>=0.8`, and only a parser that understands
 * dots and comma lists turns that back into the two-level record the procedures
 * take. The host port hands over the query FLAT — one value per key — so this
 * re-serialises and re-parses it, which is exactly what the platform hook did
 * with `router.asPath`.
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
   * Writes a new query string.
   *
   * A keyset cursor describes a position in the PREVIOUS result set, and every
   * caller of this changes which rows match — carrying it across resumes the
   * new list partway down, so the first rows matching the filter the reader
   * just applied are the ones they never see. Dropping it sends them to the
   * first page, which is what applying a filter means.
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
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
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
      enabled: !!project && !isNaN(startDate.getTime()) && !isNaN(endDate.getTime()),
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      trpc: { context: { skipBatch: true } },
    },
  };
}
