/**
 * Bridge into the legacy `trace_summaries` / `evaluation_runs` SQL path
 * (ADR-034 Phase 3/6 fallback).
 *
 * For queries the routing module returns as `"trace_summaries"` OR
 * `"evaluation_runs"`, this shim builds + executes the legacy query and
 * returns the parsed timeseries. Both routes dispatch to the SAME
 * `buildTimeseriesQuery` — the eval registry entries emit ES Painless
 * scripts today and the trace-summaries CH builder translates them into
 * the `evaluation_runs` JOIN internally.
 *
 * The prior code shipped two 120-LOC classes that differed only by method
 * name, logger tag, and doc string; consolidated here into one class with
 * ONE `run(input)` method (simp5012-002). Both the trace-summaries and
 * evaluation-runs dispatch branches in analytics.service.ts now call
 * `legacyShim.run(input)` — the underlying builder already handles both
 * source registries.
 *
 * No business logic here. No SQL templating here. Pure forwarding:
 *
 *   builder (legacy) → CH client → parser (shared with slim/rollup).
 *
 * Preserves the legacy behaviour bit-for-bit for unflagged projects and
 * for eval-source queries the eval slim/rollup can't serve.
 */

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { currentVsPreviousDates } from "~/server/api/routers/analytics/common";
import { buildTimeseriesQuery } from "~/server/analytics/clickhouse/aggregation-builder";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type { TimeseriesInputType } from "~/server/analytics/registry";
import type { TimeseriesResult } from "~/server/analytics/types";
import { createLogger } from "~/utils/logger/server";
import { AnalyticsClientUnavailableError } from "../errors";
import { adjustTimeScaleForBucketCap } from "../query-builders/_shared";
import { parseTimeseriesRows } from "./_timeseries-row-parser";

const logger = createLogger(
  "langwatch:app-layer:analytics:legacy-analytics-shim",
);

export interface LegacyAnalyticsShim {
  run(input: TimeseriesInputType): Promise<TimeseriesResult>;
}

export class ClickHouseLegacyAnalyticsShim implements LegacyAnalyticsShim {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async run(input: TimeseriesInputType): Promise<TimeseriesResult> {
    if (!input.projectId) {
      throw new Error(
        "ClickHouseLegacyAnalyticsShim.run: projectId is required",
      );
    }

    const client = await this.resolveClient(input.projectId);
    if (!client) throw new AnalyticsClientUnavailableError(input.projectId);

    const { previousPeriodStartDate, startDate, endDate } =
      currentVsPreviousDates(
        input,
        typeof input.timeScale === "number" ? input.timeScale : undefined,
      );

    const adjustedTimeScale = adjustTimeScaleForBucketCap({
      timeScale: input.timeScale,
      startDate,
      endDate,
    });

    const { sql, params } = buildTimeseriesQuery({
      projectId: input.projectId,
      startDate,
      endDate,
      previousPeriodStartDate,
      series: input.series,
      filters: input.filters,
      groupBy: input.groupBy,
      groupByKey: input.groupByKey,
      timeScale: adjustedTimeScale,
      timeZone: input.timeZone,
    });

    try {
      const result = await client.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
        clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return parseTimeseriesRows({
        rows,
        series: input.series,
        groupBy: input.groupBy,
        timeScale: input.timeScale,
      });
    } catch (error) {
      logger.error(
        {
          tenantId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to execute legacy analytics timeseries query",
      );
      throw error;
    }
  }
}
