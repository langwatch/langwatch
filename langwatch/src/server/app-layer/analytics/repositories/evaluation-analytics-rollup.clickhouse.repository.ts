/**
 * ClickHouse READ repository for the `evaluation_analytics_rollup` table
 * (ADR-034 Phase 6, app-layer module — eval mirror of
 * `trace-analytics-rollup.clickhouse.repository.ts`).
 *
 * Executes the SQL emitted by
 * `query-builders/eval-rollup-timeseries-query.ts`.
 */

import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type { TimeseriesResult } from "~/server/analytics/types";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import { AnalyticsClientUnavailableError } from "../errors";
import { buildEvalRollupTimeseriesQuery } from "../query-builders/eval-rollup-timeseries-query";
import {
  type AnalyticsTimeseriesRow,
  parseTimeseriesRows,
} from "./_timeseries-row-parser";
import type { RunTimeseriesParams } from "./trace-analytics.clickhouse.repository";

const logger = createLogger(
  "langwatch:app-layer:analytics:evaluation-analytics-rollup-read-repository",
);

export interface EvaluationAnalyticsRollupReadRepository {
  runRollupTimeseries(params: RunTimeseriesParams): Promise<TimeseriesResult>;
}

export class EvaluationAnalyticsRollupClickHouseReadRepository
  implements EvaluationAnalyticsRollupReadRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async runRollupTimeseries(
    params: RunTimeseriesParams,
  ): Promise<TimeseriesResult> {
    if (!params.tenantId) {
      throw new Error(
        "EvaluationAnalyticsRollupClickHouseReadRepository.runRollupTimeseries: tenantId is required",
      );
    }

    const client = await this.resolveClient(params.tenantId);
    if (!client) throw new AnalyticsClientUnavailableError(params.tenantId);

    const { sql, params: queryParams } = buildEvalRollupTimeseriesQuery(
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
        "Failed to execute eval rollup timeseries query",
      );
      throw error;
    }
  }
}
