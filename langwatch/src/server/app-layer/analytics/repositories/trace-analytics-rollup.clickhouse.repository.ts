/**
 * ClickHouse READ repository for the `trace_analytics_rollup` table
 * (ADR-034 Phase 3, app-layer module).
 *
 * Read counterpart to the WRITE repository at
 * `~/server/app-layer/traces/repositories/trace-analytics-rollup.clickhouse.repository.ts`
 * — kept in a sibling folder because the read concern (executing analytics
 * queries) is distinct from the write concern (inserting per-span rollup
 * rows) and lives with the rest of the new analytics module.
 *
 * Executes the SQL emitted by `query-builders/rollup-timeseries-query.ts`.
 * Owns NO SQL — that's the builder's job.
 */

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type { TimeseriesResult } from "~/server/analytics/types";
import { createLogger } from "~/utils/logger/server";
import { buildRollupTimeseriesQuery } from "../query-builders/rollup-timeseries-query";
import { AnalyticsClientUnavailableError } from "../errors";
import {
  type AnalyticsTimeseriesRow,
  parseTimeseriesRows,
} from "./_timeseries-row-parser";
import type { RunTimeseriesParams } from "./trace-analytics.clickhouse.repository";

const logger = createLogger(
  "langwatch:app-layer:analytics:trace-analytics-rollup-read-repository",
);

export interface TraceAnalyticsRollupReadRepository {
  /** Build + execute the rollup timeseries query and return parsed buckets. */
  runRollupTimeseries(params: RunTimeseriesParams): Promise<TimeseriesResult>;
}

export class TraceAnalyticsRollupClickHouseReadRepository
  implements TraceAnalyticsRollupReadRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async runRollupTimeseries(
    params: RunTimeseriesParams,
  ): Promise<TimeseriesResult> {
    if (!params.tenantId) {
      throw new Error(
        "TraceAnalyticsRollupClickHouseReadRepository.runRollupTimeseries: tenantId is required",
      );
    }

    const client = await this.resolveClient(params.tenantId);
    if (!client) throw new AnalyticsClientUnavailableError(params.tenantId);

    const { sql, params: queryParams } = buildRollupTimeseriesQuery(
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
        "Failed to execute rollup timeseries query",
      );
      throw error;
    }
  }
}
