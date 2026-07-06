/**
 * Bridge into the legacy `evaluation_runs` SQL path (ADR-034 Phase 6
 * fallback). Eval mirror of `legacy-trace-summaries.shim.ts`.
 *
 * For eval-source queries the legacy builder reads from `evaluation_runs`
 * directly (via its JOIN-aware aggregation builder — already exists and is
 * out-of-scope for ADR-034). When `pickAnalyticsTable` returns
 * `"evaluation_runs"` for an eval-source query, this shim builds + executes
 * the legacy query and returns the parsed timeseries.
 *
 * No business logic here. No SQL templating here. Pure forwarding:
 *
 *   builder (legacy) → CH client → parser (shared with slim/rollup).
 *
 * The current implementation delegates to the SAME `buildTimeseriesQuery`
 * the trace legacy shim uses — that builder handles both trace + eval
 * registry metrics (the registry's eval entries emit ES Painless scripts
 * today; the trace-summaries CH builder translates them into the
 * `evaluation_runs` JOIN). Preserves the legacy behaviour bit-for-bit for
 * unflagged-eval-metric queries.
 */

import { buildTimeseriesQuery } from "~/server/analytics/clickhouse/aggregation-builder";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type { TimeseriesInputType } from "~/server/analytics/registry";
import type { TimeseriesResult } from "~/server/analytics/types";
import { currentVsPreviousDates } from "~/server/api/routers/analytics/common";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import { AnalyticsClientUnavailableError } from "../errors";
import { parseTimeseriesRows } from "./_timeseries-row-parser";

const logger = createLogger(
  "langwatch:app-layer:analytics:legacy-evaluation-runs-shim",
);

const MAX_TIMESERIES_BUCKETS = 1000;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 1000 * 60;

export interface LegacyEvaluationRunsShim {
  runEvaluationRunsTimeseries(
    input: TimeseriesInputType,
  ): Promise<TimeseriesResult>;
}

export class ClickHouseLegacyEvaluationRunsShim
  implements LegacyEvaluationRunsShim
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async runEvaluationRunsTimeseries(
    input: TimeseriesInputType,
  ): Promise<TimeseriesResult> {
    if (!input.projectId) {
      throw new Error(
        "LegacyEvaluationRunsShim.runEvaluationRunsTimeseries: projectId is required",
      );
    }

    const client = await this.resolveClient(input.projectId);
    if (!client) throw new AnalyticsClientUnavailableError(input.projectId);

    const { previousPeriodStartDate, startDate, endDate } =
      currentVsPreviousDates(
        input,
        typeof input.timeScale === "number" ? input.timeScale : undefined,
      );

    let adjustedTimeScale = input.timeScale;
    if (typeof input.timeScale === "number") {
      const totalMinutes =
        (endDate.getTime() - startDate.getTime()) / MS_PER_MINUTE;
      const estimatedBuckets = totalMinutes / input.timeScale;
      if (estimatedBuckets > MAX_TIMESERIES_BUCKETS) {
        adjustedTimeScale = MINUTES_PER_DAY;
      }
    } else if (input.timeScale === undefined) {
      adjustedTimeScale = MINUTES_PER_DAY;
    }

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
        "Failed to execute legacy evaluation_runs timeseries query",
      );
      throw error;
    }
  }
}
