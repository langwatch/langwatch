/**
 * The trace filters the reader applied, as the capability analytics lends: the
 * same address reading `useFilterParams` makes, without the project id. Declared,
 * never imported. ARCHITECTURE.md §10.1.
 */

import { UiTraceFilters, type UiTraceFilterReading } from "@langwatch/browser-host/capabilities";
import { readUiStorage } from "@langwatch/browser-host/storage";
import { nowInstant } from "@langwatch/time";
import { useMemo } from "react";

import {
  countFilters,
  readFiltersFromQuery,
  readSavedViewFilters,
} from "../model/analytics-filter-params.ts";
import { readAnalyticsPeriod } from "../model/analytics-period.ts";
import { parseQuery } from "./use-filter-params.ts";

/** A repeated key collapses to its last value, as the router's route reading does. */
function queryOf(search: string): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {};
  new URLSearchParams(search).forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

/**
 * One render's applied filters: undefined unless a filter narrows the read, so
 * a free-text query alone stays unfiltered, as main's annotations page did.
 */
export function useUiTraceFiltersReading({
  search,
  projectId,
}: {
  /** The address's query string, `?` included or not. */
  search: string;
  projectId: string | undefined;
}): UiTraceFilterReading | undefined {
  const query = useMemo(() => queryOf(search), [search]);
  // Read once per render and never a dependency, as `useAnalyticsPeriod` does.
  const now = nowInstant();
  const period = useMemo(
    () => readAnalyticsPeriod({ query, now }).period,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query],
  );

  return useMemo(() => {
    const queryParams = parseQuery(query);
    const filters = {
      ...readFiltersFromQuery(queryParams),
      ...readSavedViewFilters({ queryParams, projectId, readStorage: readUiStorage }),
    };
    if (!countFilters(filters).hasAnyFilters) return void 0;
    return {
      startDate: period.startDate.epochMilliseconds,
      endDate: period.endDate.epochMilliseconds,
      filters,
      ...(typeof queryParams.query === "string" ? { query: queryParams.query } : {}),
      ...(queryParams.negateFilters === "true" ? { negateFilters: true } : {}),
    };
  }, [query, projectId, period]);
}

export class BrowserUiTraceFilters extends UiTraceFilters {
  constructor(private readonly reading: UiTraceFilterReading | undefined) {
    super();
  }

  applied(): UiTraceFilterReading | undefined {
    return this.reading;
  }
}

/** The capability over one render's reading. */
export function createBrowserUiTraceFilters({
  reading,
}: {
  reading: UiTraceFilterReading | undefined;
}): UiTraceFilters {
  return new BrowserUiTraceFilters(reading);
}
