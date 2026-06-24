/**
 * ClickHouse READ repository for the slim `evaluation_analytics` table
 * (ADR-034 Phase 6, app-layer module — eval mirror of
 * `trace-analytics.clickhouse.repository.ts`).
 *
 * Executes the SQL emitted by
 * `query-builders/eval-slim-timeseries-query.ts`. Owns NO SQL — that's the
 * builder's job.
 */

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type { TimeseriesResult } from "~/server/analytics/types";
import { createLogger } from "~/utils/logger/server";
import { AnalyticsClientUnavailableError } from "../errors";
import { buildEvalSlimTimeseriesQuery } from "../query-builders/eval-slim-timeseries-query";
import {
  type AnalyticsTimeseriesRow,
  parseTimeseriesRows,
} from "./_timeseries-row-parser";
import type { RunTimeseriesParams } from "./trace-analytics.clickhouse.repository";

const logger = createLogger(
  "langwatch:app-layer:analytics:evaluation-analytics-read-repository",
);

export interface EvaluationAnalyticsReadRepository {
  runSlimTimeseries(params: RunTimeseriesParams): Promise<TimeseriesResult>;
}

export class EvaluationAnalyticsClickHouseReadRepository
  implements EvaluationAnalyticsReadRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async runSlimTimeseries(
    params: RunTimeseriesParams,
  ): Promise<TimeseriesResult> {
    if (!params.tenantId) {
      throw new Error(
        "EvaluationAnalyticsClickHouseReadRepository.runSlimTimeseries: tenantId is required",
      );
    }

    const client = await this.resolveClient(params.tenantId);
    if (!client) throw new AnalyticsClientUnavailableError(params.tenantId);

    const { sql, params: queryParams } = buildEvalSlimTimeseriesQuery(
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
        "Failed to execute eval slim timeseries query",
      );
      throw error;
    }
  }
}
