/**
 * Seed rows, proofs and shapes for the timeseries row-equality cases (rollup, slim, eval rollup,
 * eval slim): two tenants sharing trace and evaluation ids, B scaled by 100; expected results are
 * in built-reads.expected.fixture.json.
 */
import { randomUUID } from "node:crypto";

import type { AnalyticsFilters, AnalyticsSeries } from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";

export const RUN = randomUUID();
export const TENANT_A = `test-pathc-a-${RUN}`;
export const TENANT_B = `test-pathc-b-${RUN}`;
export const AGGREGATE = `test-pathc-agg-${RUN}`;
export const TABLES = [
  "trace_analytics",
  "trace_analytics_rollup",
  "evaluation_analytics",
  "evaluation_analytics_rollup",
] as const;

export const DAY = "2026-06-15";
export const stamp = (time: string) => `${DAY} ${time}.000`;
export const epoch = (time: string) => Date.parse(`${DAY}T${time}Z`);
/** Current period 08:00-14:00, previous 02:00-08:00. */
export const START = epoch("08:00:00");
export const END = epoch("14:00:00");
export const PREVIOUS_START = epoch("02:00:00");

export type TimeseriesTable = (typeof TABLES)[number];

export const tagOf = (tenantId: string) => (tenantId === TENANT_A ? "a" : "b");
export const scaleOf = (tenantId: string) => (tenantId === TENANT_A ? 1 : 100);

export type TraceSeed = {
  index: number;
  time: string;
  updated?: string;
  cost: number | null;
  version?: string;
  spanCount?: number;
  overrides?: Record<string, unknown>;
};

/** Trace 0 has two versions, the newer without a cost; 2 is dimension-only; 3 is previous. */
export const TRACE_SEEDS: TraceSeed[] = [
  { index: 0, time: "09:10:00", updated: "09:10:00", cost: 1 },
  { index: 0, time: "09:10:00", updated: "09:20:00", cost: null },
  { index: 1, time: "10:30:00", cost: 2 },
  { index: 2, time: "11:00:00", cost: 50, version: "2026-08-01", spanCount: 0 },
  { index: 3, time: "05:00:00", cost: 4 },
  { index: 4, time: "13:59:00", cost: 8 },
];

export function traceRow(tenantId: string, seed: TraceSeed) {
  const tag = tagOf(tenantId);
  const scale = scaleOf(tenantId);
  const i = seed.index;
  const odd = i % 2 === 1;
  return {
    TenantId: tenantId,
    TraceId: `trace-${RUN}-${i}`,
    Version: seed.version ?? "2026-10-05",
    OccurredAt: stamp(seed.time),
    CreatedAt: stamp(seed.time),
    UpdatedAt: stamp(seed.updated ?? seed.time),
    TraceName: i === 1 ? "" : `${tag}-name-${i % 2}`,
    Origin: odd ? "evaluation" : "",
    Models: [],
    Labels: i === 1 ? [] : [`${tag}-label-${i % 2}`, `${tag}-label-x`],
    TopicId: i === 1 ? null : `${tag}-topic-${i % 2}`,
    SubTopicId: `${tag}-sub-${i % 2}`,
    UserId: i === 1 ? null : `${tag}-user-${i === 4 ? 0 : i}`,
    ConversationId: `${tag}-thread-${i % 3}`,
    CustomerId: i === 4 ? "" : `${tag}-customer`,
    TotalCost: seed.cost === null ? null : seed.cost * scale,
    NonBilledCost: seed.cost === null ? null : (seed.cost * scale) / 4,
    TotalDurationMs: (i + 1) * 100 * scale,
    TimeToFirstTokenMs: i === 1 ? null : (i + 1) * 10 * scale,
    TokensPerSecond: (i + 1) * scale,
    PromptTokens: (i + 1) * 3 * scale,
    CompletionTokens: odd ? null : (i + 1) * 5 * scale,
    CacheReadTokens: i * scale,
    CacheWriteTokens: 2 * scale,
    ReasoningTokens: odd ? 0 : scale,
    HasError: odd,
    SpanCount: seed.spanCount ?? 1,
    EarliestSpanStartMs: seed.spanCount === 0 ? 0 : epoch(seed.time),
    Attributes: {
      outcome: i === 1 ? "fail" : "ok",
      [`${tag}.only`]: "v",
      "langwatch.prompt_ids": JSON.stringify([`${tag}-prompt-${i % 2}`]),
    },
  };
}

export const ROLLUP_SEEDS = [
  { minute: "05:00:00", model: "m-1", n: 1 },
  { minute: "09:00:00", model: "m-1", n: 2 },
  { minute: "10:00:00", model: "m-1", n: 3 },
  { minute: "10:00:00", model: "m-2", n: 4 },
  { minute: "13:59:00", model: "m-2", n: 5 },
];

export function rollupRow(tenantId: string, { minute, model, n }: (typeof ROLLUP_SEEDS)[number]) {
  const s = scaleOf(tenantId);
  return {
    TenantId: tenantId,
    BucketStart: stamp(minute),
    Model: model,
    SpanType: "llm",
    SpanCount: n,
    TraceCount: n % 3,
    ErrorCount: 0,
    CostSum: n * 1.5 * s,
    NonBilledCostSum: n * 0.25 * s,
    DurationSum: n * 1000 * s,
    PromptTokensSum: n * 10 * s,
    CompletionTokensSum: n * 20 * s,
    CacheReadTokensSum: n * s,
    CacheWriteTokensSum: 2 * n * s,
    ReasoningTokensSum: 3 * n * s,
  };
}

export type EvalSeed = {
  index: number;
  time: string;
  updated?: string;
  status: string;
  passed: boolean | null;
  score: number | null;
  label: string | null;
  type: string;
};

/** Evaluation 0 has two versions; 1 is an errored run carrying a stray verdict; 3 is previous. */
export const EVAL_SEEDS: EvalSeed[] = [
  {
    index: 0,
    time: "09:00:00",
    updated: "09:00:00",
    status: "scheduled",
    passed: null,
    score: null,
    label: null,
    type: "langevals/exact_match",
  },
  {
    index: 0,
    time: "09:00:00",
    updated: "09:05:00",
    status: "processed",
    passed: true,
    score: 0.9,
    label: "good",
    type: "langevals/exact_match",
  },
  {
    index: 1,
    time: "10:00:00",
    status: "error",
    passed: false,
    score: 0.1,
    label: "bad",
    type: "langevals/exact_match",
  },
  {
    index: 2,
    time: "11:00:00",
    status: "processed",
    passed: false,
    score: 0.3,
    label: null,
    type: "",
  },
  {
    index: 3,
    time: "05:00:00",
    status: "processed",
    passed: true,
    score: 0.7,
    label: "good",
    type: "custom/judge",
  },
  {
    index: 4,
    time: "13:00:00",
    status: "processed",
    passed: true,
    score: 0.5,
    label: "fine",
    type: "custom/judge",
  },
];

export function evalRow(tenantId: string, seed: EvalSeed) {
  const tag = tagOf(tenantId);
  const shift = tenantId === TENANT_A ? 0 : 0.05;
  return {
    TenantId: tenantId,
    EvaluationId: `eval-${RUN}-${seed.index}`,
    Version: "1",
    OccurredAt: stamp(seed.time),
    CreatedAt: stamp(seed.time),
    UpdatedAt: stamp(seed.updated ?? seed.time),
    EvaluatorType: seed.type,
    EvaluatorName: `${tag}-evaluator`,
    Status: seed.status,
    IsGuardrail: false,
    Passed: tenantId === TENANT_B && seed.passed !== null ? !seed.passed : seed.passed,
    Score: seed.score === null ? null : seed.score + shift,
    Label: seed.label === null ? null : `${tag}-${seed.label}`,
    Model: null,
    TraceId: `trace-${RUN}-${seed.index}`,
    UserId: null,
    ConversationId: null,
    CustomerId: null,
    Origin: null,
    DurationMs: 10,
    TotalCost: null,
    NonBilledCost: null,
    Attributes: {},
    StartedAt: epoch(seed.time),
    CompletedAt: epoch(seed.time),
    AppliedEventIds: [],
  };
}

export const EVAL_ROLLUP_SEEDS = [
  { minute: "05:00:00", type: "custom/judge", status: "processed", n: 1 },
  { minute: "09:00:00", type: "langevals/exact_match", status: "processed", n: 2 },
  { minute: "10:00:00", type: "langevals/exact_match", status: "error", n: 3 },
  { minute: "10:00:00", type: "", status: "processed", n: 4 },
  { minute: "13:00:00", type: "custom/judge", status: "processed", n: 5 },
];

export function evalRollupRow(
  tenantId: string,
  { minute, type, status, n }: (typeof EVAL_ROLLUP_SEEDS)[number],
) {
  const s = scaleOf(tenantId);
  return {
    TenantId: tenantId,
    BucketStart: stamp(minute),
    EvaluatorType: type,
    Status: status,
    EvalCount: n * s,
    PassCount: n,
    FailCount: n * s - n,
    ScoreSum: n * 0.5 * s,
    ScoreCount: n * s,
  };
}

/** A tenant's own proof, and an aggregate's over A (open) and B (closed part way through). */
export const PROOFS: { name: string; projectId: string; proof: () => Authorization }[] = [
  {
    name: "tenant A's own proof",
    projectId: TENANT_A,
    proof: () => analyticsProof({ projectId: TENANT_A }),
  },
  {
    name: "an aggregate's proof over A and B",
    projectId: AGGREGATE,
    proof: () =>
      analyticsProof({
        projectId: AGGREGATE,
        shared: [
          { projectId: TENANT_A, from: epoch("00:00:00") },
          { projectId: TENANT_B, from: epoch("04:00:00"), until: epoch("11:30:00") },
        ],
      }),
  },
];

export type Shape = {
  name: string;
  table: TimeseriesTable;
  series: AnalyticsSeries[];
  groupBy?: string;
  filters?: AnalyticsFilters;
  excludeOrigins?: string[];
  timeScale: number | "full";
  timeZone?: string;
};

export const ROLLUP_METRICS = [
  "performance.total_cost",
  "performance.cost_billed",
  "performance.cost_non_billed",
  "performance.completion_time",
  "performance.prompt_tokens",
  "performance.completion_tokens",
  "performance.cache_read_tokens",
  "performance.cache_write_tokens",
  "performance.reasoning_tokens",
  "performance.total_tokens",
  "performance.total_processed_tokens",
];
export const ROLLUP_SERIES: AnalyticsSeries[] = [
  ...ROLLUP_METRICS.map((metric) => ({ metric, aggregation: "sum" }) as AnalyticsSeries),
  { metric: "performance.completion_time", aggregation: "avg" } as AnalyticsSeries,
];

export const SLIM_VALUE_METRICS = [
  ...ROLLUP_METRICS,
  "performance.first_token",
  "performance.tokens_per_second",
];
export const SLIM_SERIES: AnalyticsSeries[] = [
  ...SLIM_VALUE_METRICS.flatMap((metric) =>
    (["sum", "avg", "min", "max"] as const).map(
      (aggregation) => ({ metric, aggregation }) as AnalyticsSeries,
    ),
  ),
  ...(["metadata.trace_id", "metadata.user_id", "metadata.thread_id"] as const).map(
    (metric) => ({ metric, aggregation: "cardinality" }) as AnalyticsSeries,
  ),
  ...(["median", "p90", "p99"] as const).map(
    (aggregation) => ({ metric: "performance.completion_time", aggregation }) as AnalyticsSeries,
  ),
  { metric: "performance.total_cost", aggregation: "p95" } as AnalyticsSeries,
];
export const SLIM_SHORT: AnalyticsSeries[] = [
  { metric: "performance.total_cost", aggregation: "sum" } as AnalyticsSeries,
  { metric: "metadata.trace_id", aggregation: "cardinality" } as AnalyticsSeries,
  { metric: "performance.completion_time", aggregation: "median" } as AnalyticsSeries,
];

export const EVAL_METRICS = [
  "evaluations.evaluation_score",
  "evaluations.evaluation_pass_rate",
  "evaluations.evaluation_runs",
];
/** `avg` of run counts is not a rollup read; the router sends it elsewhere. */
export const EVAL_ROLLUP_SERIES: AnalyticsSeries[] = EVAL_METRICS.flatMap((metric) =>
  (["sum", "avg", "cardinality"] as const)
    .filter((aggregation) => !(metric === "evaluations.evaluation_runs" && aggregation === "avg"))
    .map((aggregation) => ({ metric, aggregation }) as AnalyticsSeries),
);
/** Runs are evaluation ids, so only counted; the value metrics take every aggregation. */
export const EVAL_SLIM_SERIES: AnalyticsSeries[] = [
  ...EVAL_METRICS.slice(0, 2).flatMap((metric) =>
    (["sum", "avg", "min", "max", "cardinality", "median"] as const).map(
      (aggregation) => ({ metric, aggregation }) as AnalyticsSeries,
    ),
  ),
  { metric: "evaluations.evaluation_runs", aggregation: "cardinality" } as AnalyticsSeries,
];

export const both = (field: (tag: string) => string) => [field("a"), field("b")];
export const SLIM_FILTERS: [string, AnalyticsFilters][] = [
  ["topics.topics", { "topics.topics": both((t) => `${t}-topic-0`) }],
  ["topics.subtopics", { "topics.subtopics": both((t) => `${t}-sub-1`) }],
  ["metadata.user_id", { "metadata.user_id": both((t) => `${t}-user-0`) }],
  ["metadata.thread_id", { "metadata.thread_id": both((t) => `${t}-thread-1`) }],
  ["metadata.customer_id", { "metadata.customer_id": both((t) => `${t}-customer`) }],
  ["metadata.labels", { "metadata.labels": both((t) => `${t}-label-0`) }],
  ["metadata.prompt_ids", { "metadata.prompt_ids": both((t) => `${t}-prompt-0`) }],
  ["traces.origin", { "traces.origin": ["evaluation"] }],
  ["traces.error true", { "traces.error": ["true"] }],
  ["traces.error false", { "traces.error": ["false"] }],
  ["traces.name", { "traces.name": both((t) => `${t}-name-0`) }],
  ["metadata.key", { "metadata.key": ["a.only"] }],
  ["metadata.value", { "metadata.value": { outcome: ["ok"] } }],
  ["two filters", { "metadata.labels": both((t) => `${t}-label-x`), "traces.error": ["false"] }],
];
export const SLIM_GROUP_BYS = [
  "error.has_error",
  "topics.topics",
  "traces.trace_name",
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.customer_id",
  "metadata.labels",
];

export const SHAPES: Shape[] = [
  {
    name: "rollup, full",
    table: "trace_analytics_rollup",
    series: ROLLUP_SERIES,
    timeScale: "full",
  },
  {
    name: "rollup, hourly in Amsterdam",
    table: "trace_analytics_rollup",
    series: ROLLUP_SERIES,
    timeScale: 60,
    timeZone: "Europe/Amsterdam",
  },
  {
    name: "rollup, daily in Amsterdam",
    table: "trace_analytics_rollup",
    series: ROLLUP_SERIES,
    timeScale: 1440,
    timeZone: "Europe/Amsterdam",
  },
  {
    name: "slim, every metric, full",
    table: "trace_analytics",
    series: SLIM_SERIES,
    timeScale: "full",
  },
  {
    name: "slim, every metric, 30 minutes in Amsterdam",
    table: "trace_analytics",
    series: SLIM_SERIES,
    timeScale: 30,
    timeZone: "Europe/Amsterdam",
  },
  ...SLIM_GROUP_BYS.map((groupBy): Shape => ({
    name: `slim by ${groupBy}`,
    table: "trace_analytics",
    series: SLIM_SHORT,
    groupBy,
    timeScale: "full",
  })),
  {
    name: "slim by labels, hourly",
    table: "trace_analytics",
    series: SLIM_SHORT,
    groupBy: "metadata.labels",
    timeScale: 60,
  },
  ...SLIM_FILTERS.map(([name, filters]): Shape => ({
    name: `slim filtered on ${name}`,
    table: "trace_analytics",
    series: SLIM_SHORT,
    filters,
    timeScale: "full",
  })),
  {
    name: "slim excluding evaluation origins",
    table: "trace_analytics",
    series: SLIM_SHORT,
    excludeOrigins: ["evaluation"],
    timeScale: "full",
  },
  {
    name: "slim excluding origins, filtered and grouped",
    table: "trace_analytics",
    series: SLIM_SHORT,
    excludeOrigins: ["evaluation"],
    filters: { "metadata.labels": both((t) => `${t}-label-x`) },
    groupBy: "metadata.labels",
    timeScale: 60,
  },
  ...(["full", 60] as const).flatMap((timeScale) =>
    [undefined, "evaluations.evaluator_type", "evaluations.evaluation_status"].map(
      (groupBy): Shape => ({
        name: `eval rollup by ${groupBy ?? "nothing"}, ${timeScale}`,
        table: "evaluation_analytics_rollup",
        series: EVAL_ROLLUP_SERIES,
        groupBy,
        timeScale,
      }),
    ),
  ),
  ...[
    undefined,
    "evaluations.evaluator_type",
    "evaluations.evaluation_passed",
    "evaluations.evaluation_label",
    "evaluations.evaluation_status",
  ].map((groupBy): Shape => ({
    name: `eval slim by ${groupBy ?? "nothing"}`,
    table: "evaluation_analytics",
    series: EVAL_SLIM_SERIES,
    groupBy,
    timeScale: "full",
  })),
  {
    name: "eval slim, hourly in Amsterdam",
    table: "evaluation_analytics",
    series: EVAL_SLIM_SERIES,
    timeScale: 60,
    timeZone: "Europe/Amsterdam",
  },
];
