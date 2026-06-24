/**
 * ClickHouse READ repository for the slim `trace_analytics` table (ADR-034
 * Phase 3, app-layer module).
 *
 * Read counterpart to the WRITE repository at
 * `~/server/app-layer/traces/repositories/trace-analytics.clickhouse.repository.ts`
 * — kept in a sibling folder because the read concern (executing analytics
 * queries) is distinct from the write concern (upserting projection rows) and
 * lives with the rest of the new analytics module.
 *
 * Executes the SQL emitted by `query-builders/slim-timeseries-query.ts`. Owns
 * NO SQL — that's the builder's job. The split keeps the repository free of
 * SQL string templating and lets unit tests assert on builder output without
 * a ClickHouse client.
 *
 * Multi-tenancy: every query carries `WHERE TenantId = {tenantId:String}` as
 * the first predicate via the query builder; the repo additionally validates
 * the tenant id is non-empty before dialling out (mirroring the existing
 * write-side repositories' `EventUtils.validateTenantId` discipline).
 */

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type { SeriesInputType } from "~/server/analytics/registry";
import type { TimeseriesResult } from "~/server/analytics/types";
import { createLogger } from "~/utils/logger/server";
import type { AnalyticsTimeseriesBuilderInput } from "../types";
import { buildSlimTimeseriesQuery } from "../query-builders/slim-timeseries-query";
import { AnalyticsClientUnavailableError } from "../errors";
import {
  type AnalyticsTimeseriesRow,
  parseTimeseriesRows,
} from "./_timeseries-row-parser";

const logger = createLogger(
  "langwatch:app-layer:analytics:trace-analytics-read-repository",
);

/**
 * Inputs to a slim/rollup timeseries read.
 *
 * `tenantId` is asserted before the CH client is resolved; `builderInput`
 * carries the SQL inputs (with `timeScale` potentially adjusted for the
 * bucket-count safety net); `originalTimeScale` is the caller's pre-adjustment
 * timeScale, used by the row parser to decide how to bucket date keys
 * (`"full"` collapses every row into a single `"full"`-keyed bucket; a number
 * leaves the parser to fall through to whatever the SQL `date` column emitted).
 * Series + groupBy come from the public input — the SQL alias generated for
 * each series is what the parser keys into the row payload by.
 */
export interface RunTimeseriesParams {
  readonly tenantId: string;
  readonly builderInput: AnalyticsTimeseriesBuilderInput;
  readonly series: readonly SeriesInputType[];
  readonly groupBy?: string;
  readonly originalTimeScale?: number | "full";
}

export interface TraceAnalyticsReadRepository {
  /** Build + execute the slim timeseries query and return parsed buckets. */
  runSlimTimeseries(params: RunTimeseriesParams): Promise<TimeseriesResult>;
}

export class TraceAnalyticsClickHouseReadRepository
  implements TraceAnalyticsReadRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async runSlimTimeseries(
    params: RunTimeseriesParams,
  ): Promise<TimeseriesResult> {
    if (!params.tenantId) {
      throw new Error(
        "TraceAnalyticsClickHouseReadRepository.runSlimTimeseries: tenantId is required",
      );
    }

    const client = await this.resolveClient(params.tenantId);
    if (!client) throw new AnalyticsClientUnavailableError(params.tenantId);

    const { sql, params: queryParams } = buildSlimTimeseriesQuery(
      params.builderInput,
    );

    try {
      const result = await client.query({
        query: sql,
        query_params: queryParams,
        format: "JSONEachRow",
        clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
      });
      const rows = (await result.json()) as AnalyticsTimeseriesRow[];
      return parseTimeseriesRows({
        rows,
        series: params.series,
        groupBy: params.groupBy,
        timeScale: params.originalTimeScale,
      });
    } catch (error) {
      logger.error(
        {
          tenantId: params.tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to execute slim timeseries query",
      );
      throw error;
    }
  }
}
