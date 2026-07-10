/**
 * Internal types for the app-layer analytics module (ADR-034 Phase 3).
 *
 * Public input/result shapes (TimeseriesInputType, TimeseriesResult,
 * FeedbacksResult, TopDocumentsResult, AnalyticsTableHint) still live in the
 * legacy `~/server/analytics/types.ts` / `~/server/analytics/registry.ts` —
 * this module re-uses them. Anything *internal* to the new structure
 * (repository contracts, builder I/O) goes here.
 */

import type { SeriesInputType } from "~/server/analytics/registry";
import type { FilterField } from "~/server/filters/types";

/**
 * Built ClickHouse query — mirrors the legacy `BuiltQuery` shape so the shim
 * and new query-builders share one wire format with the executors.
 */
export interface BuiltAnalyticsQuery {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * Common input contract to every analytics query-builder (slim / rollup /
 * legacy shim). Mirrors the relevant fields of the legacy
 * `TimeseriesQueryInput`; kept here so the new module doesn't pull from the
 * legacy SQL builder for type definitions.
 */
export interface AnalyticsTimeseriesBuilderInput {
  projectId: string;
  startDate: Date;
  endDate: Date;
  previousPeriodStartDate: Date;
  series: SeriesInputType[];
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >;
  groupBy?: string;
  groupByKey?: string;
  timeScale?: number | "full";
  timeZone?: string;
}
