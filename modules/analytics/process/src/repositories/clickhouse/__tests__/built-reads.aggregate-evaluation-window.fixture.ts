/**
 * Seed rows and reads for the aggregate's evaluation-window cases: two member traces, one before
 * the grant opens and one after, both evaluated after it opens, so a window on the evaluation's
 * own time would pass the pre-share trace (ADR-177 v4.15).
 */
import { randomUUID } from "node:crypto";

import type { AnalyticsSeries, AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";

const RUN = randomUUID();
export const AGGREGATE = `test-agg-eval-window-${RUN}`;
export const MEMBER = `test-agg-eval-window-member-${RUN}`;
export const TENANTS = [AGGREGATE, MEMBER];
export const SEEDED_TABLES = [
  "trace_summaries",
  "evaluation_runs",
  "evaluation_analytics",
  "evaluation_analytics_rollup",
];

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
export const GRANT_FROM = at("10:00:00");
const EVALUATED_AT = "10:45:00";
export const START = at("08:00:00");
export const END = at("14:00:00");

const TRACES = [
  { traceId: `trace-${RUN}-before-share`, time: "09:30:00" },
  { traceId: `trace-${RUN}-after-share`, time: "10:30:00" },
] as const;

/** The Evaluations page's "Total evaluation runs", its empty key dropped as the service does. */
export const RUNS_SERIES: AnalyticsSeries = {
  metric: "evaluations.evaluation_runs",
  aggregation: "cardinality",
};

function traceSummaryRow({ traceId, time }: (typeof TRACES)[number]) {
  const occurredAt = new Date(at(time).epochMilliseconds);
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: MEMBER,
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
    TotalCost: 0,
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

const evaluationIdOf = ({ traceId }: (typeof TRACES)[number]) => `eval-${traceId}`;
const evaluatedAt = () => new Date(at(EVALUATED_AT).epochMilliseconds);

function evaluationRunRow(trace: (typeof TRACES)[number]) {
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: MEMBER,
    EvaluationId: evaluationIdOf(trace),
    Version: "1",
    EvaluatorId: `${RUN}-check`,
    EvaluatorType: "langevals/exact_match",
    TraceId: trace.traceId,
    Status: "processed",
    Score: 1,
    Passed: 1,
    Label: null,
    LastProcessedEventId: `evt-${randomUUID()}`,
    ScheduledAt: evaluatedAt().toISOString(),
    UpdatedAt: evaluatedAt().toISOString(),
  };
}

function evaluationAnalyticsRow(trace: (typeof TRACES)[number]) {
  return {
    TenantId: MEMBER,
    EvaluationId: evaluationIdOf(trace),
    Version: "2026-10-05",
    OccurredAt: evaluatedAt(),
    CreatedAt: evaluatedAt(),
    UpdatedAt: evaluatedAt(),
    EvaluatorType: "langevals/exact_match",
    Status: "processed",
    IsGuardrail: false,
    Passed: true,
    Score: 1,
    TraceId: trace.traceId,
    DurationMs: 0,
    Attributes: {},
  };
}

function evaluationRollupRow() {
  return {
    TenantId: MEMBER,
    BucketStart: evaluatedAt(),
    EvaluatorType: "langevals/exact_match",
    Status: "processed",
    EvalCount: 1,
    PassCount: 1,
    FailCount: 0,
    ErrorCount: 0,
    SkippedCount: 0,
    ScoreSum: 1,
    ScoreCount: 1,
    DurationSum: 0,
    CostSum: 0,
    NonBilledCostSum: 0,
  };
}

export const seeds = () => [
  { table: "trace_summaries", values: TRACES.map(traceSummaryRow) },
  { table: "evaluation_runs", values: TRACES.map(evaluationRunRow) },
  { table: "evaluation_analytics", values: TRACES.map(evaluationAnalyticsRow) },
  { table: "evaluation_analytics_rollup", values: TRACES.map(evaluationRollupRow) },
];

/** The total-runs input for one project over the whole day. */
export const inputFor = (projectId: string): AnalyticsTimeseriesInput => ({
  projectId,
  startDate: START.epochMilliseconds,
  endDate: END.epochMilliseconds,
  filters: {},
  series: [RUNS_SERIES],
  timeScale: "full",
  timeZone: "UTC",
});
