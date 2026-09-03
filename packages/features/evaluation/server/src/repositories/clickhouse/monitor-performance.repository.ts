import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { EvaluationClickHouseResolver } from "../../ports/evaluation.port";
import {
  MonitorPerformanceRepository,
  type MonitorPerformanceBucket,
  type MonitorPerformanceBucketQuery,
} from "../monitor-performance.repository";

const logger = createLogger("langwatch:evaluation:clickhouse.monitor-performance.repository");

const ANALYTICS_CLICKHOUSE_SETTINGS = {
  max_bytes_before_external_group_by: "500000000",
  max_execution_time: 15,
} as const;

function validateTimeZone(value: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

const queryForTimeZone = (timeZone: string): string => `
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

type ClickHouseMonitorPerformanceRow = {
  EvaluatorId: string;
  Period: "current" | "previous";
  Day: string;
  ScoreSum: number;
  ScoreCount: string;
  PassSum: string;
  PassCount: string;
};

/** Private parity query for the online-evaluation performance chart. */
export class ClickHouseMonitorPerformanceRepository extends MonitorPerformanceRepository {
  static create(options: {
    resolveClient: EvaluationClickHouseResolver;
  }): ClickHouseMonitorPerformanceRepository {
    return new ClickHouseMonitorPerformanceRepository(options);
  }

  private constructor(private readonly options: { resolveClient: EvaluationClickHouseResolver }) {
    super();
  }

  async findBuckets(input: MonitorPerformanceBucketQuery): Promise<MonitorPerformanceBucket[]> {
    if (input.evaluatorIds.length === 0) return [];
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseMonitorPerformanceRepository.findBuckets",
    );
    const client = await this.options.resolveClient(input.tenantId);
    try {
      const result = await client.query({
        query: queryForTimeZone(input.timeZone),
        query_params: {
          tenantId: input.tenantId,
          evaluatorIds: input.evaluatorIds,
          previousStart: new Date(input.previousStartMs),
          currentStart: new Date(input.currentStartMs),
          end: new Date(input.endMs),
        },
        format: "JSONEachRow",
        clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
      });
      return (await result.json<ClickHouseMonitorPerformanceRow>()).map(
        (row): MonitorPerformanceBucket => ({
          evaluatorId: row.EvaluatorId,
          period: row.Period,
          day: row.Day,
          scoreSum: Number(row.ScoreSum),
          scoreCount: Number(row.ScoreCount),
          passSum: Number(row.PassSum),
          passCount: Number(row.PassCount),
        }),
      );
    } catch (error) {
      logger.warn(
        {
          tenantId: input.tenantId,
          evaluatorCount: input.evaluatorIds.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to load online evaluation performance",
      );
      throw error;
    }
  }
}
