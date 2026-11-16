/**
 * Seed rows and reads for the aggregate's `trace_summaries` and evaluation-chart window cases:
 * one trace per row, each value a distinct power of two so a sum names its traces, plus one
 * trace id both members use, only the first with a run of its own check (ADR-177).
 */
import { randomUUID } from "node:crypto";

import {
  buildSeriesName,
  type AnalyticsSeries,
  type AnalyticsTable,
  type AnalyticsTimeseriesInput,
  type AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import { Temporal } from "@langwatch/time";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import type { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";

const RUN = randomUUID();
export const AGGREGATE = `test-agg-summaries-${RUN}`;
export const WHOLE_HISTORY_MEMBER = `test-agg-summaries-a-${RUN}`;
export const LATE_MEMBER = `test-agg-summaries-b-${RUN}`;
const FOREIGN = `test-agg-summaries-foreign-${RUN}`;
export const TENANTS = [AGGREGATE, WHOLE_HISTORY_MEMBER, LATE_MEMBER, FOREIGN];
export const SEEDED_TABLES = ["trace_summaries", "evaluation_runs"];
export const EVALUATOR = `${RUN}-check`;
const OTHER_EVALUATOR = `${RUN}-other-check`;
export const SHARED_ID_EVALUATOR = `${RUN}-shared-id-check`;

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
const LATE_MEMBER_FROM = at("10:00:00");

const TRACES: { tenantId: string; time: string; value: number }[] = [
  { tenantId: WHOLE_HISTORY_MEMBER, time: "08:00:00", value: 1 },
  { tenantId: WHOLE_HISTORY_MEMBER, time: "11:00:00", value: 2 },
  { tenantId: LATE_MEMBER, time: "09:30:00", value: 4 }, // before its grant starts
  { tenantId: LATE_MEMBER, time: "10:30:00", value: 8 },
  { tenantId: FOREIGN, time: "10:30:00", value: 16 }, // outside the proof
  { tenantId: AGGREGATE, time: "10:30:00", value: 32 }, // the aggregate's own
];

const SHARED_TRACE_ID = `trace-${RUN}-shared`;
const SHARED_ID_TRACES: { tenantId: string; time: string; value: number }[] = [
  { tenantId: WHOLE_HISTORY_MEMBER, time: "11:30:00", value: 64 },
  { tenantId: LATE_MEMBER, time: "11:30:00", value: 128 },
];

const traceIdOf = (index: number) => `trace-${RUN}-${index}`;

function traceSummaryRow(
  { tenantId, time, value }: (typeof TRACES)[number],
  index: number,
  traceId = traceIdOf(index),
) {
  const occurredAt = new Date(at(time).epochMilliseconds);
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: occurredAt,
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TotalDurationMs: 200,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: [],
    TotalCost: value,
    TokensEstimated: false,
    TotalPromptTokenCount: 0,
    TotalCompletionTokenCount: 0,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

function evaluationRunRow({
  trace,
  index,
  evaluatorId,
  traceId = traceIdOf(index),
}: {
  trace: (typeof TRACES)[number];
  index: number;
  evaluatorId: string;
  traceId?: string;
}) {
  const scheduledAt = new Date(at(trace.time).epochMilliseconds).toISOString();
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: trace.tenantId,
    EvaluationId: `eval-${randomUUID()}`,
    Version: "1",
    EvaluatorId: evaluatorId,
    EvaluatorType: "langevals/exact_match",
    TraceId: traceId,
    Status: "processed",
    Score: evaluatorId === EVALUATOR ? trace.value : 1000,
    Passed: 1,
    Label: null,
    LastProcessedEventId: `evt-${randomUUID()}`,
    ScheduledAt: scheduledAt,
    UpdatedAt: scheduledAt,
  };
}

export const seeds = () => [
  {
    table: "trace_summaries",
    values: [
      ...TRACES.map((trace, index) => traceSummaryRow(trace, index)),
      ...SHARED_ID_TRACES.map((trace, index) => traceSummaryRow(trace, index, SHARED_TRACE_ID)),
    ],
  },
  {
    table: "evaluation_runs",
    values: [
      ...TRACES.flatMap((trace, index) =>
        [EVALUATOR, OTHER_EVALUATOR].map((evaluatorId) =>
          evaluationRunRow({ trace, index, evaluatorId }),
        ),
      ),
      evaluationRunRow({
        trace: SHARED_ID_TRACES[0]!,
        index: 0,
        evaluatorId: SHARED_ID_EVALUATOR,
        traceId: SHARED_TRACE_ID,
      }),
    ],
  },
];

export const COST_SERIES: AnalyticsSeries = {
  metric: "performance.total_cost",
  aggregation: "sum",
};
export const SCORE_SERIES: AnalyticsSeries = {
  metric: "evaluations.evaluation_score",
  aggregation: "sum",
  key: EVALUATOR,
};

export function seriesTotal(result: AnalyticsTimeseriesResult, series: AnalyticsSeries): number {
  const name = buildSeriesName(series, 0);
  return result.currentPeriod.reduce((sum, bucket) => sum + Number(bucket[name] ?? 0), 0);
}

/** One series over the whole day, as the aggregate's dashboard asks it. */
export function seriesRead({
  authorization,
  table,
  series,
  filters = {},
}: {
  authorization: Authorization;
  table: AnalyticsTable;
  series: AnalyticsSeries;
  filters?: AnalyticsTimeseriesInput["filters"];
}): Parameters<ClickHouseAnalyticsRepository["runTimeseries"]>[0] {
  const startDate = at("06:00:00");
  const endDate = at("14:00:00");
  return {
    table,
    authorization,
    input: {
      projectId: AGGREGATE,
      startDate: startDate.epochMilliseconds,
      endDate: endDate.epochMilliseconds,
      filters,
      series: [series],
      timeScale: "full",
      timeZone: "UTC",
    },
    startDate,
    endDate,
    previousPeriodStartDate: startDate.subtract({ hours: 8 }),
    adjustedTimeScale: "full",
    maxResultRows: undefined,
  };
}

/** Member A shared for its whole history, member B only from its grant's start. */
export const aggregateProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [
      { projectId: WHOLE_HISTORY_MEMBER, from: 0 },
      { projectId: LATE_MEMBER, from: LATE_MEMBER_FROM.epochMilliseconds },
    ],
  });

export const IN_WINDOWS = 1 + 2 + 8 + 32;
/** Both members' traces on the shared trace id, inside each window. */
export const SHARED_ID_TOTAL = 64 + 128;
