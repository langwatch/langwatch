import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { Temporal, toDate } from "@langwatch/time";

import { evaluatorErrorCodeSql } from "../../rules/evaluator-error-code.rules.ts";
import {
  MonitorPerformanceRepository,
  type EvaluatorOutcomeRow,
  type EvaluatorOutcomeRowQuery,
  type EvaluatorTypeUsageRow,
  type EvaluatorTypeUsageRowQuery,
  type MonitorPerformanceBucket,
  type MonitorPerformanceBucketQuery,
} from "../monitor-performance.repository.ts";
import type { EvaluationClickHouseResolver } from "./clickhouse.evaluation-session.store.ts";

/** A moment as a ClickHouse statement carries it. The client serialises this into
 *  `DateTime64(3)`; an instant serialises to `{}`, so the conversion is here. */
type ClickHouseMoment = ReturnType<typeof toDate>;

/** The moment `epochMilliseconds` names, as ClickHouse wants it. */
const clickHouseMomentOf = (epochMilliseconds: number): ClickHouseMoment =>
  toDate(Temporal.Instant.fromEpochMilliseconds(epochMilliseconds));

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
    count(Passed) AS PassCount,
    sumMap([ifNull(Label, '')], [toUInt64(1)]) AS LabelCounts
  FROM (
    SELECT
      evaluations.EvaluatorId AS EvaluatorId,
      evaluations.Status AS Status,
      evaluations.Score AS Score,
      evaluations.Passed AS Passed,
      evaluations.Label AS Label,
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
        tupleElement(Latest, 5) AS Passed,
        tupleElement(Latest, 6) AS Label
      FROM (
        SELECT
          TenantId,
          EvaluationId,
          argMax(tuple(TraceId, EvaluatorId, Status, Score, Passed, Label), UpdatedAt) AS Latest
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

const outcomeErrorCode = evaluatorErrorCodeSql({ column: "Error" });

/** Each run at its latest revision; the error text becomes its code inside ClickHouse. */
const OUTCOME_QUERY = `
  SELECT
    EvaluatorId,
    any(EvaluatorType) AS EvaluatorType,
    ErrorCode,
    count() AS Runs,
    countIf(Status = 'error') AS Errors,
    countIf(Status = 'skipped') AS Skipped,
    maxIf(toUnixTimestamp64Milli(SettledAt), Status = 'error') AS LastErrorAt
  FROM (
    SELECT
      tupleElement(Latest, 1) AS EvaluatorId,
      tupleElement(Latest, 2) AS EvaluatorType,
      tupleElement(Latest, 3) AS Status,
      tupleElement(Latest, 4) AS ErrorCode,
      tupleElement(Latest, 5) AS SettledAt
    FROM (
      SELECT
        EvaluationId,
        argMax(
          tuple(
            EvaluatorId,
            EvaluatorType,
            Status,
            if(Status = 'error', ${outcomeErrorCode.sql}, ''),
            coalesce(CompletedAt, UpdatedAt)
          ),
          UpdatedAt
        ) AS Latest
      FROM evaluation_runs
      WHERE TenantId = {tenantId:String}
        AND ScheduledAt >= {since:DateTime64(3)}
        AND ScheduledAt < {until:DateTime64(3)}
      GROUP BY TenantId, EvaluationId
    )
  )
  GROUP BY EvaluatorId, ErrorCode
  ORDER BY EvaluatorId, ErrorCode
  LIMIT {limit:UInt32}
`;

type ClickHouseTypeUsageRow = {
  EvaluatorType: string;
  Projects: string;
  Runs: string;
  Errors: string;
  Skipped: string;
  ErrorCodes: [string[], (number | string)[]];
};

type ClickHouseOutcomeRow = {
  EvaluatorId: string;
  EvaluatorType: string;
  ErrorCode: string;
  Runs: string;
  Errors: string;
  Skipped: string;
  LastErrorAt: string;
};

type ClickHouseMonitorPerformanceRow = {
  EvaluatorId: string;
  Period: "current" | "previous";
  Day: string;
  ScoreSum: number;
  ScoreCount: string;
  PassSum: string;
  PassCount: string;
  /** sumMap's answer: the labels seen and, in step, how often each was seen. */
  LabelCounts: [string[], (number | string)[]];
};

/** Unlabelled results land under the empty key; that key is not a label. */
const toLabelCounts = (
  counts: ClickHouseMonitorPerformanceRow["LabelCounts"] | undefined,
): Record<string, number> => {
  const [labels, occurrences] = counts ?? [[], []];
  return Object.fromEntries(
    labels.flatMap((label, index) =>
      label === "" ? [] : [[label, Number(occurrences[index] ?? 0)] as const],
    ),
  );
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
          previousStart: clickHouseMomentOf(input.previousStartMs),
          currentStart: clickHouseMomentOf(input.currentStartMs),
          end: clickHouseMomentOf(input.endMs),
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
          labelCounts: toLabelCounts(row.LabelCounts),
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

  async findOutcomeRows(input: EvaluatorOutcomeRowQuery): Promise<EvaluatorOutcomeRow[]> {
    if (input.until <= input.since) return [];
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseMonitorPerformanceRepository.findOutcomeRows",
    );
    const client = await this.options.resolveClient(input.tenantId);
    const result = await client.query({
      query: OUTCOME_QUERY,
      query_params: {
        ...outcomeErrorCode.params,
        tenantId: input.tenantId,
        since: clickHouseMomentOf(input.since),
        until: clickHouseMomentOf(input.until),
        limit: input.limit,
      },
      format: "JSONEachRow",
      clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
    });
    return (await result.json<ClickHouseOutcomeRow>()).map((row): EvaluatorOutcomeRow => {
      const lastErrorAt = Number(row.LastErrorAt);
      return {
        evaluatorId: row.EvaluatorId,
        evaluatorType: row.EvaluatorType,
        errorCode: row.ErrorCode,
        runs: Number(row.Runs),
        errors: Number(row.Errors),
        skipped: Number(row.Skipped),
        lastErrorAt: lastErrorAt > 0 ? lastErrorAt : null,
      };
    });
  }

  async findTypeUsageRows(input: EvaluatorTypeUsageRowQuery): Promise<EvaluatorTypeUsageRow[]> {
    if (input.until <= input.since) return [];
    const client = await this.options.resolveClient("");
    const result = await client.query({
      // Every tenant's runs at their latest revision, per evaluator type.
      query: `
  SELECT
    EvaluatorType,
    uniqExact(TenantId) AS Projects,
    count() AS Runs,
    countIf(Status = 'error') AS Errors,
    countIf(Status = 'skipped') AS Skipped,
    sumMapIf([ErrorCode], [toUInt64(1)], Status = 'error') AS ErrorCodes
  FROM (
    SELECT
      TenantId,
      tupleElement(Latest, 1) AS EvaluatorType,
      tupleElement(Latest, 2) AS Status,
      tupleElement(Latest, 3) AS ErrorCode
    FROM (
      SELECT
        TenantId,
        EvaluationId,
        argMax(
          tuple(EvaluatorType, Status, if(Status = 'error', ${outcomeErrorCode.sql}, '')),
          UpdatedAt
        ) AS Latest
      FROM evaluation_runs
      WHERE ScheduledAt >= {since:DateTime64(3)}
        AND ScheduledAt < {until:DateTime64(3)}
      GROUP BY TenantId, EvaluationId
    )
  )
  GROUP BY EvaluatorType
  ORDER BY Runs DESC, EvaluatorType
  LIMIT {limit:UInt32}
`,
      query_params: {
        ...outcomeErrorCode.params,
        since: clickHouseMomentOf(input.since),
        until: clickHouseMomentOf(input.until),
        limit: input.limit,
      },
      format: "JSONEachRow",
      clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
      // A staff platform report (ADR-202): counts per evaluator type over every tenant at once.
      SKIP_TENANT_CHECK: true,
    });
    return (await result.json<ClickHouseTypeUsageRow>()).map((row): EvaluatorTypeUsageRow => ({
      evaluatorType: row.EvaluatorType,
      projects: Number(row.Projects),
      runs: Number(row.Runs),
      errors: Number(row.Errors),
      skipped: Number(row.Skipped),
      errorsByCode: toLabelCounts(row.ErrorCodes),
    }));
  }
}
