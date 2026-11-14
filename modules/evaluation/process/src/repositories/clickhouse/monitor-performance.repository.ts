import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, param, tenantScope } from "@langwatch/clickhouse-client/builder";
import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

import {
  MonitorPerformanceRepository,
  type MonitorPerformanceBucket,
  type MonitorPerformanceBucketQuery,
} from "../monitor-performance.repository.ts";
import { evaluationRuns as runs } from "./clickhouse.evaluation-runs.table.ts";
import { traceSummaries as summaries } from "./clickhouse.trace-summaries.table.ts";

const logger = createLogger("langwatch:evaluation:clickhouse.monitor-performance.repository");

/** A run is scheduled up to this long either side of the trace it scores. */
const SCHEDULE_MARGIN_MS = 2 * 24 * 60 * 60 * 1000;

const ANALYTICS_CLICKHOUSE_SETTINGS = {
  max_bytes_before_external_group_by: "500000000",
  max_execution_time: 15,
} as const;

/** The zone a day is cut in; an unknown zone reads as UTC rather than failing the chart. */
function validateTimeZone(value: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/** The tenant's processed runs per evaluator, period and day of the trace they score. */
function bucketsRead(input: MonitorPerformanceBucketQuery) {
  const scope = tenantScope.single({ tenantId: input.tenantId });
  const traces = clickhouseRead({ scope })
    .from(summaries)
    .select({
      TenantId: summaries.TenantId,
      TraceId: summaries.TraceId,
      TraceOccurredAt: fn.argMax(summaries.OccurredAt, summaries.UpdatedAt),
    })
    .where(({ range }) =>
      range(summaries.OccurredAt, { from: input.previousStartMs, until: input.endMs }),
    )
    .groupBy(summaries.TenantId, summaries.TraceId)
    .as("traces");
  const latest = clickhouseRead({ scope })
    .from(runs)
    .select({
      TenantId: runs.TenantId,
      Latest: fn.argMax(
        fn.tuple(runs.TraceId, runs.EvaluatorId, runs.Status, runs.Score, runs.Passed),
        runs.UpdatedAt,
      ),
    })
    .where(({ and, oneOf, range }) =>
      and(
        oneOf(runs.EvaluatorId, input.evaluatorIds),
        range(runs.ScheduledAt, {
          from: input.previousStartMs - SCHEDULE_MARGIN_MS,
          until: input.endMs + SCHEDULE_MARGIN_MS,
        }),
      ),
    )
    .groupBy(runs.TenantId, runs.EvaluationId)
    .as("latest");
  const evaluations = clickhouseRead({ scope })
    .from(latest)
    .select({
      TenantId: latest.TenantId,
      TraceId: fn.tupleElement(latest.Latest, "0"),
      EvaluatorId: fn.tupleElement(latest.Latest, "1"),
      Status: fn.tupleElement(latest.Latest, "2"),
      Score: fn.tupleElement(latest.Latest, "3"),
      Passed: fn.tupleElement(latest.Latest, "4"),
    })
    .as("evaluations");
  const scored = clickhouseRead({ scope })
    .from(traces)
    .innerJoin(evaluations, ({ eq }) => eq(evaluations.TraceId, traces.TraceId))
    .select(({ gte }) => ({
      TenantId: traces.TenantId,
      EvaluatorId: evaluations.EvaluatorId,
      Score: evaluations.Score,
      Passed: evaluations.Passed,
      Period: fn.if(
        gte(traces.TraceOccurredAt, input.currentStartMs),
        param.string("current"),
        param.string("previous"),
      ),
      Day: fn.toString(
        fn.toStartOfDay(traces.TraceOccurredAt, { timeZone: validateTimeZone(input.timeZone) }),
      ),
    }))
    .where(({ eq }) => eq(evaluations.Status, param.string("processed")))
    .as("scored");
  return clickhouseRead({ scope })
    .from(scored)
    .select({
      EvaluatorId: scored.EvaluatorId,
      Period: scored.Period,
      Day: scored.Day,
      ScoreSum: fn.sum(fn.ifNull(scored.Score, param.float64(0))),
      ScoreCount: fn.count(scored.Score),
      PassSum: fn.sum(fn.ifNull(scored.Passed, param.uint16(0))),
      PassCount: fn.count(scored.Passed),
    })
    .groupBy(scored.EvaluatorId, scored.Period, scored.Day)
    .orderBy(scored.EvaluatorId)
    .orderBy(scored.Period)
    .orderBy(scored.Day)
    .settings(ANALYTICS_CLICKHOUSE_SETTINGS)
    .build();
}

/** Private parity query for the online-evaluation performance chart, one built read. */
export class ClickHouseMonitorPerformanceRepository extends MonitorPerformanceRepository {
  static create(options: {
    resolveQueryClient: (tenantId: string) => Promise<Pick<ClickHouseQueryClient, "read">>;
  }): ClickHouseMonitorPerformanceRepository {
    return new ClickHouseMonitorPerformanceRepository(options);
  }

  private constructor(
    private readonly options: {
      resolveQueryClient: (tenantId: string) => Promise<Pick<ClickHouseQueryClient, "read">>;
    },
  ) {
    super();
  }

  async findBuckets(input: MonitorPerformanceBucketQuery): Promise<MonitorPerformanceBucket[]> {
    if (input.evaluatorIds.length === 0) return [];
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseMonitorPerformanceRepository.findBuckets",
    );
    const client = await this.options.resolveQueryClient(input.tenantId);
    try {
      const result = await client.read({ statement: bucketsRead(input) });
      return result.rows.map((row): MonitorPerformanceBucket => ({
        evaluatorId: row.EvaluatorId,
        period: row.Period === "current" ? "current" : "previous",
        day: row.Day,
        scoreSum: Number(row.ScoreSum),
        scoreCount: Number(row.ScoreCount),
        passSum: Number(row.PassSum),
        passCount: Number(row.PassCount),
      }));
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
