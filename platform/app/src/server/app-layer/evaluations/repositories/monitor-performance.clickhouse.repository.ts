import { validateTenantId } from "@langwatch/clickhouse";
import { createLogger } from "@langwatch/observability";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import { AnalyticsClientUnavailableError } from "~/server/app-layer/analytics/errors";
import { validateTimeZone } from "~/server/app-layer/analytics/query-builders/_shared";
import type { ClickHouseClientResolver } from "~/server/app-layer/clients/clickhouse/tenant-client";
import type {
  FindMonitorPerformanceParams,
  MonitorPerformanceBucket,
  MonitorPerformancePeriod,
  MonitorPerformanceRepository,
} from "./monitor-performance.repository";

const logger = createLogger(
  "langwatch:app-layer:evaluations:monitor-performance-repository",
);

interface ClickHouseMonitorPerformanceRow {
  EvaluatorId: string;
  Period: MonitorPerformancePeriod;
  Day: string;
  ScoreSum: number;
  ScoreCount: string;
  PassSum: string;
  PassCount: string;
}

/**
 * The analytics page reads evaluations through the trace-anchored legacy
 * path: latest-revision evaluation runs joined onto their trace summaries,
 * date-filtered and day-bucketed on the trace's OccurredAt. This query keeps
 * the exact same envelope so the number on the Online Evaluations table
 * always equals the number on the analytics page for the same period:
 * runs without a matching trace in the window (including thread-level runs
 * with no TraceId) do not count, and a run belongs to the day its trace
 * occurred, not the day the evaluation was scheduled.
 *
 * The evaluation subquery carries a two-day cushion instead of an exact
 * range because runs are scheduled after their trace occurs; the cushion
 * keeps partition pruning while still admitting late evaluations of
 * in-window traces.
 */
const queryForTimeZone = (timeZone: string) => `
  SELECT
    EvaluatorId,
    if(TraceOccurredAt >= {currentStart:DateTime64(3)}, 'current', 'previous') AS Period,
    toString(toStartOfDay(TraceOccurredAt, '${validateTimeZone(timeZone)}')) AS Day,
    sum(ifNull(Score, 0)) AS ScoreSum,
    count(Score) AS ScoreCount,
    sum(ifNull(Passed, 0)) AS PassSum,
    count(Passed) AS PassCount
  FROM (
    SELECT
      evaluations.EvaluatorId AS EvaluatorId,
      evaluations.Status AS Status,
      evaluations.Score AS Score,
      evaluations.Passed AS Passed,
      traces.TraceOccurredAt AS TraceOccurredAt
    FROM (
      SELECT
        TenantId,
        TraceId,
        argMax(OccurredAt, UpdatedAt) AS TraceOccurredAt
      FROM trace_summaries
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= {previousStart:DateTime64(3)}
        AND OccurredAt < {end:DateTime64(3)}
      GROUP BY TenantId, TraceId
    ) AS traces
    INNER JOIN (
      SELECT
        TenantId,
        tupleElement(Latest, 1) AS TraceId,
        tupleElement(Latest, 2) AS EvaluatorId,
        tupleElement(Latest, 3) AS Status,
        tupleElement(Latest, 4) AS Score,
        tupleElement(Latest, 5) AS Passed
      FROM (
        SELECT
          TenantId,
          EvaluationId,
          argMax(tuple(TraceId, EvaluatorId, Status, Score, Passed), UpdatedAt) AS Latest
        FROM evaluation_runs
        WHERE TenantId = {tenantId:String}
          AND EvaluatorId IN {evaluatorIds:Array(String)}
          AND ScheduledAt >= {previousStart:DateTime64(3)} - INTERVAL 2 DAY
          AND ScheduledAt < {end:DateTime64(3)} + INTERVAL 2 DAY
        GROUP BY TenantId, EvaluationId
      )
    ) AS evaluations
      ON traces.TenantId = evaluations.TenantId
      AND traces.TraceId = evaluations.TraceId
  )
  WHERE Status = 'processed'
  GROUP BY EvaluatorId, Period, Day
  ORDER BY EvaluatorId, Period, Day
`;

export class MonitorPerformanceClickHouseRepository
  implements MonitorPerformanceRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async findBuckets(
    params: FindMonitorPerformanceParams,
  ): Promise<MonitorPerformanceBucket[]> {
    if (params.evaluatorIds.length === 0) return [];
    validateTenantId(
      { tenantId: params.tenantId },
      "MonitorPerformanceClickHouseRepository.findBuckets",
    );

    const client = await this.resolveClient(params.tenantId);
    if (!client) {
      throw new AnalyticsClientUnavailableError(params.tenantId);
    }

    try {
      const rows = await client.query<ClickHouseMonitorPerformanceRow>({
        // The read joins `trace_summaries` onto `evaluation_runs`; the metric
        // is labelled with the table this repository is about.
        table: "evaluation_runs",
        sql: queryForTimeZone(params.timeZone),
        params: {
          tenantId: params.tenantId,
          evaluatorIds: params.evaluatorIds,
          previousStart: new Date(params.previousStartMs),
          currentStart: new Date(params.currentStartMs),
          end: new Date(params.endMs),
        },
        settings: {
          ...ANALYTICS_CLICKHOUSE_SETTINGS,
          max_execution_time: 15,
        },
      });
      return rows.map(toPerformanceBucket);
    } catch (error) {
      logger.error(
        {
          tenantId: params.tenantId,
          evaluatorCount: params.evaluatorIds.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to load online evaluation performance",
      );
      throw error;
    }
  }
}

const toPerformanceBucket = (
  row: ClickHouseMonitorPerformanceRow,
): MonitorPerformanceBucket => ({
  evaluatorId: row.EvaluatorId,
  period: row.Period,
  day: row.Day,
  scoreSum: Number(row.ScoreSum),
  scoreCount: Number(row.ScoreCount),
  passSum: Number(row.PassSum),
  passCount: Number(row.PassCount),
});
