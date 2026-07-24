import { createLogger } from "@langwatch/observability";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import { AnalyticsClientUnavailableError } from "~/server/app-layer/analytics/errors";
import { validateTimeZone } from "~/server/app-layer/analytics/query-builders/_shared";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
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

const queryForTimeZone = (timeZone: string) => `
  SELECT
    EvaluatorId,
    if(ScheduledAt >= {currentStart:DateTime64(3)}, 'current', 'previous') AS Period,
    toString(toStartOfDay(ScheduledAt, '${validateTimeZone(timeZone)}')) AS Day,
    sum(ifNull(Score, 0)) AS ScoreSum,
    count(Score) AS ScoreCount,
    sum(ifNull(Passed, 0)) AS PassSum,
    count(Passed) AS PassCount
  FROM (
    SELECT
      tupleElement(Latest, 1) AS EvaluatorId,
      tupleElement(Latest, 2) AS Status,
      tupleElement(Latest, 3) AS Score,
      tupleElement(Latest, 4) AS Passed,
      tupleElement(Latest, 5) AS ScheduledAt
    FROM (
      SELECT
        EvaluationId,
        argMax(
          tuple(EvaluatorId, Status, Score, Passed, ScheduledAt),
          UpdatedAt
        ) AS Latest
      FROM evaluation_runs
      PREWHERE TenantId = {tenantId:String}
        AND ScheduledAt >= {previousStart:DateTime64(3)}
        AND ScheduledAt < {end:DateTime64(3)}
      WHERE EvaluatorId IN {evaluatorIds:Array(String)}
      GROUP BY EvaluationId
    )
  )
  WHERE Status = 'processed'
    AND EvaluatorId IN {evaluatorIds:Array(String)}
    AND ScheduledAt >= {previousStart:DateTime64(3)}
    AND ScheduledAt < {end:DateTime64(3)}
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
    EventUtils.validateTenantId(
      { tenantId: params.tenantId },
      "MonitorPerformanceClickHouseRepository.findBuckets",
    );

    const client = await this.resolveClient(params.tenantId);
    if (!client) {
      throw new AnalyticsClientUnavailableError(params.tenantId);
    }

    try {
      const result = await client.query({
        query: queryForTimeZone(params.timeZone),
        query_params: {
          tenantId: params.tenantId,
          evaluatorIds: params.evaluatorIds,
          previousStart: new Date(params.previousStartMs),
          currentStart: new Date(params.currentStartMs),
          end: new Date(params.endMs),
        },
        format: "JSONEachRow",
        clickhouse_settings: {
          ...ANALYTICS_CLICKHOUSE_SETTINGS,
          max_execution_time: 15,
        },
      });
      const rows = await result.json<ClickHouseMonitorPerformanceRow>();
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
