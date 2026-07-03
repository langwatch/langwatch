/**
 * Unified ClickHouse READ repository for the ADR-034 analytics tables.
 *
 * The 4 forked repos (trace slim + trace rollup + eval slim + eval rollup)
 * differed ONLY by:
 *   - which SQL builder they called;
 *   - whether they exposed the method as `runSlimTimeseries` or
 *     `runRollupTimeseries`;
 *   - the logger name.
 *
 * Consolidated here (simp5012-004 / s5014-007) into ONE parameterised
 * class with a single `run(params)` method. `analytics.service.ts` now
 * picks the right instance via the routing decision and calls `run(...)`
 * on it; the per-target method-name distinction was noise. Adding a
 * new destination (sim/exp/suite read paths for Phase 7) is a one-line
 * factory call now, not another 80-LOC copy-paste.
 *
 * Multi-tenancy: every query carries `WHERE TenantId = {tenantId:String}`
 * as the first predicate via the query builder; the repo additionally
 * validates the tenant id is non-empty before dialling out.
 */

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type { SeriesInputType } from "~/server/analytics/registry";
import type { TimeseriesResult } from "~/server/analytics/types";
import { createLogger } from "~/utils/logger/server";
import { buildEvalRollupTimeseriesQuery } from "../query-builders/eval-rollup-timeseries-query";
import { buildEvalSlimTimeseriesQuery } from "../query-builders/eval-slim-timeseries-query";
import { buildRollupTimeseriesQuery } from "../query-builders/rollup-timeseries-query";
import { buildSlimTimeseriesQuery } from "../query-builders/slim-timeseries-query";
import { AnalyticsClientUnavailableError } from "../errors";
import type { AnalyticsTimeseriesBuilderInput } from "../types";
import {
  type AnalyticsTimeseriesRow,
  parseTimeseriesRows,
} from "./_timeseries-row-parser";

export interface RunTimeseriesParams {
  readonly tenantId: string;
  readonly builderInput: AnalyticsTimeseriesBuilderInput;
  readonly series: readonly SeriesInputType[];
  readonly groupBy?: string;
  readonly originalTimeScale?: number | "full";
}

type TimeseriesBuilder = (input: AnalyticsTimeseriesBuilderInput) => {
  sql: string;
  params: Record<string, unknown>;
};

export interface AnalyticsTimeseriesReadRepository {
  run(params: RunTimeseriesParams): Promise<TimeseriesResult>;
}

class AnalyticsTimeseriesClickHouseReadRepository
  implements AnalyticsTimeseriesReadRepository
{
  private readonly logger: ReturnType<typeof createLogger>;

  constructor(
    private readonly resolveClient: ClickHouseClientResolver,
    private readonly builder: TimeseriesBuilder,
    private readonly targetLabel: string,
  ) {
    this.logger = createLogger(
      `langwatch:app-layer:analytics:${targetLabel}-read-repository`,
    );
  }

  async run(params: RunTimeseriesParams): Promise<TimeseriesResult> {
    if (!params.tenantId) {
      throw new Error(
        `AnalyticsTimeseriesReadRepository[${this.targetLabel}].run: tenantId is required`,
      );
    }

    const client = await this.resolveClient(params.tenantId);
    if (!client) throw new AnalyticsClientUnavailableError(params.tenantId);

    const { sql, params: queryParams } = this.builder(params.builderInput);

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
      this.logger.error(
        {
          tenantId: params.tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        `Failed to execute ${this.targetLabel} timeseries query`,
      );
      throw error;
    }
  }
}

/**
 * Factories for the 4 built-in destinations. Adding a 5th (e.g. Phase 7
 * simulation / experiment / suite read paths) is one more factory here.
 */
export function createTraceSlimReadRepo(
  resolveClient: ClickHouseClientResolver,
): AnalyticsTimeseriesReadRepository {
  return new AnalyticsTimeseriesClickHouseReadRepository(
    resolveClient,
    buildSlimTimeseriesQuery,
    "trace-analytics",
  );
}

export function createTraceRollupReadRepo(
  resolveClient: ClickHouseClientResolver,
): AnalyticsTimeseriesReadRepository {
  return new AnalyticsTimeseriesClickHouseReadRepository(
    resolveClient,
    buildRollupTimeseriesQuery,
    "trace-analytics-rollup",
  );
}

export function createEvalSlimReadRepo(
  resolveClient: ClickHouseClientResolver,
): AnalyticsTimeseriesReadRepository {
  return new AnalyticsTimeseriesClickHouseReadRepository(
    resolveClient,
    buildEvalSlimTimeseriesQuery,
    "evaluation-analytics",
  );
}

export function createEvalRollupReadRepo(
  resolveClient: ClickHouseClientResolver,
): AnalyticsTimeseriesReadRepository {
  return new AnalyticsTimeseriesClickHouseReadRepository(
    resolveClient,
    buildEvalRollupTimeseriesQuery,
    "evaluation-analytics-rollup",
  );
}
