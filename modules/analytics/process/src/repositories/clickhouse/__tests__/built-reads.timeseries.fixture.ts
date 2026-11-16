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

/** The tables the trace_summaries (path A) cases seed. */
export const SUMMARY_TABLES = ["trace_summaries", "stored_spans", "evaluation_runs"] as const;

/**
 * A trace_summaries version of a trace seed, with one span and one evaluation run for the first
 * version of each trace. Trace 1 has no NonBilledCost and the legacy non-billable flag.
 */
export function summaryRows(tenantId: string, seed: TraceSeed) {
  const tag = tagOf(tenantId);
  const scale = scaleOf(tenantId);
  const i = seed.index;
  const odd = i % 2 === 1;
  const traceId = `trace-${RUN}-${i}`;
  const at = stamp(seed.time);
  const attributes: Record<string, string> = {
    outcome: i === 1 ? "fail" : "ok",
    [`${tag}.only`]: "v",
    "gen_ai.conversation.id": `${tag}-thread-${i % 3}`,
    "langwatch.customer_id": i === 4 ? "" : `${tag}-customer`,
    "langwatch.prompt_ids": JSON.stringify([`${tag}-prompt-${i % 2}`]),
    "langwatch.reserved.cache_read_tokens": String(i * scale),
    "langwatch.reserved.cache_creation_tokens": String(2 * scale),
    "langwatch.reserved.reasoning_tokens": String(odd ? 0 : scale),
  };
  if (i !== 1) {
    attributes["langwatch.user_id"] = `${tag}-user-${i === 4 ? 0 : i}`;
    attributes["langwatch.labels"] = JSON.stringify([`${tag}-label-${i % 2}`, `${tag}-label-x`]);
  } else {
    attributes["langwatch.cost.non_billable"] = "true";
  }
  if (odd) attributes["langwatch.origin"] = "evaluation";
  const summary = {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: attributes,
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: stamp(seed.updated ?? seed.time),
    ComputedIOSchemaVersion: "",
    TotalDurationMs: (i + 1) * 100 * scale,
    TimeToFirstTokenMs: i === 1 ? null : (i + 1) * 10 * scale,
    TokensPerSecond: (i + 1) * scale,
    TotalPromptTokenCount: (i + 1) * 3 * scale,
    TotalCompletionTokenCount: odd ? null : (i + 1) * 5 * scale,
    TotalCost: seed.cost === null ? null : seed.cost * scale,
    NonBilledCost: seed.cost === null || i === 1 ? null : (seed.cost * scale) / 4,
    SpanCount: seed.spanCount ?? 1,
    ContainsErrorStatus: odd ? 1 : 0,
    ContainsOKStatus: 1,
    Models: [],
    TokensEstimated: false,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: i === 1 ? null : `${tag}-topic-${i % 2}`,
    SubTopicId: `${tag}-sub-${i % 2}`,
    HasAnnotation: 0,
    TraceName: i === 1 ? "" : `${tag}-name-${i % 2}`,
  };
  if (seed.updated !== undefined && seed.updated !== seed.time) return { summary };
  const span = {
    ProjectionId: `proj-span-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: `span-${RUN}-${i}`,
    Sampled: 1,
    StartTime: at,
    EndTime: at,
    DurationMs: 1,
    SpanName: "span",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: { "langwatch.span.type": odd ? "tool" : "llm" },
    ScopeName: "",
    "Events.Timestamp": [at],
    "Events.Name": ["other"],
    "Events.Attributes": [{}],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
  };
  const run = {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${RUN}-${i}`,
    Version: "1",
    EvaluatorId: "ev",
    EvaluatorName: "check",
    EvaluatorType: "langevals/exact_match",
    TraceId: traceId,
    Status: "processed",
    Score: i / 10,
    Passed: i === 4 ? 0 : 1,
    Label: "good",
    LastProcessedEventId: `evt-${randomUUID()}`,
    ScheduledAt: at,
    UpdatedAt: at,
  };
  return { summary, span, run };
}

/**
 * A second span for traces 0, 1, 3 and 4 (first version), the same type as the first so no span
 * filter changes its traces: token usage, a thumbs vote (down on odd traces) and a scored event.
 */
export function extraSpan(tenantId: string, seed: TraceSeed) {
  const i = seed.index;
  if (i === 2 || (seed.updated !== undefined && seed.updated !== seed.time)) return undefined;
  const scale = scaleOf(tenantId);
  const at = stamp(seed.time);
  return {
    ProjectionId: `proj-span-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: `trace-${RUN}-${i}`,
    SpanId: `span-${RUN}-${i}-extra`,
    Sampled: 1,
    StartTime: at,
    EndTime: at,
    DurationMs: 1,
    SpanName: "extra",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {
      "langwatch.span.type": i % 2 === 1 ? "tool" : "llm",
      "gen_ai.usage.input_tokens": String((i + 1) * 7 * scale),
      "gen_ai.usage.output_tokens": String((i + 1) * 11 * scale),
    },
    ScopeName: "",
    "Events.Timestamp": [at, at],
    "Events.Name": ["thumbs_up_down", "graded"],
    "Events.Attributes": [
      { "event.metrics.vote": i % 2 === 1 ? "-1" : "1" },
      { "event.metrics.score": String(i * 0.25 * scale) },
    ],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
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
  table: TimeseriesTable | "trace_summaries";
  series: AnalyticsSeries[];
  groupBy?: string;
  filters?: AnalyticsFilters;
  negateFilters?: boolean;
  traceIds?: string[];
  excludeOrigins?: string[];
  groupByKey?: string;
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

/** Series on the trace row only: every value metric, the counts, a mapped column and span types. */
export const SUMMARY_SERIES: AnalyticsSeries[] = [
  ...SLIM_SERIES,
  { metric: "metadata.span_type", aggregation: "cardinality" } as AnalyticsSeries,
  { metric: "metrics.total_cost", aggregation: "max" } as AnalyticsSeries,
];
const clean = { "traces.error": ["false"] } as AnalyticsFilters;
/** A series' own filter: additive and not, as a count, and as a percentage. */
export const SUMMARY_FILTERED_SERIES: AnalyticsSeries[] = [
  { metric: "performance.total_cost", aggregation: "sum", filters: clean } as AnalyticsSeries,
  { metric: "performance.completion_time", aggregation: "avg", filters: clean } as AnalyticsSeries,
  {
    metric: "metadata.trace_id",
    aggregation: "cardinality",
    filters: clean,
    asPercent: true,
  } as AnalyticsSeries,
  {
    metric: "performance.total_cost",
    aggregation: "max",
    filters: clean,
    asPercent: true,
  } as AnalyticsSeries,
];
const summaryFilters: [string, AnalyticsFilters, boolean][] = [
  ["topics.topics", { "topics.topics": both((t) => `${t}-topic-0`) }, false],
  ["traces.name, negated", { "traces.name": both((t) => `${t}-name-0`) }, true],
  ["spans.type", { "spans.type": ["tool"] } as AnalyticsFilters, false],
  ["spans.type, negated", { "spans.type": ["tool"] } as AnalyticsFilters, true],
  ["evaluations.passed", { "evaluations.passed": { ev: ["false"] } } as AnalyticsFilters, false],
];

/** Path A: the standard trace_summaries shape (numeric scale, or full with a grouping). */
export const SUMMARY_SHAPES: Shape[] = [
  {
    name: "summaries, every metric, 30 minutes in Amsterdam",
    table: "trace_summaries",
    series: SUMMARY_SERIES,
    timeScale: 30,
    timeZone: "Europe/Amsterdam",
  },
  {
    name: "summaries, every metric, daily",
    table: "trace_summaries",
    series: SUMMARY_SERIES,
    timeScale: 1440,
  },
  ...SLIM_GROUP_BYS.filter((groupBy) => groupBy !== "metadata.labels").map((groupBy): Shape => ({
    name: `summaries by ${groupBy}`,
    table: "trace_summaries",
    series: SLIM_SHORT,
    groupBy,
    timeScale: "full",
  })),
  ...summaryFilters.map(([name, filters, negateFilters]): Shape => ({
    name: `summaries filtered on ${name}`,
    table: "trace_summaries",
    series: SLIM_SHORT,
    filters,
    negateFilters,
    timeScale: 60,
  })),
  {
    name: "summaries for two traces",
    table: "trace_summaries",
    series: SLIM_SHORT,
    traceIds: [`trace-${RUN}-0`, `trace-${RUN}-4`],
    timeScale: 60,
  },
  {
    name: "summaries excluding origins, grouped by trace name",
    table: "trace_summaries",
    series: SLIM_SHORT,
    excludeOrigins: ["evaluation"],
    groupBy: "traces.trace_name",
    timeScale: 60,
  },
  {
    name: "summaries with series filters, hourly",
    table: "trace_summaries",
    series: SUMMARY_FILTERED_SERIES,
    timeScale: 60,
  },
  {
    name: "summaries with series filters, by user",
    table: "trace_summaries",
    series: SUMMARY_FILTERED_SERIES,
    groupBy: "metadata.user_id",
    timeScale: "full",
  },
  {
    name: "summary, every metric, both periods",
    table: "trace_summaries",
    series: SUMMARY_SERIES,
    timeScale: "full",
  },
  {
    name: "summary with series filters, both periods",
    table: "trace_summaries",
    series: SUMMARY_FILTERED_SERIES,
    timeScale: "full",
  },
  {
    name: "summary filtered on spans.type, negated, both periods",
    table: "trace_summaries",
    series: SLIM_SHORT,
    filters: { "spans.type": ["tool"] } as AnalyticsFilters,
    negateFilters: true,
    timeScale: "full",
  },
  {
    name: "summary for two current traces, an empty previous period",
    table: "trace_summaries",
    series: SUMMARY_SERIES,
    traceIds: [`trace-${RUN}-0`, `trace-${RUN}-4`],
    timeScale: "full",
  },
];

const mixed = (metric: string, aggregation: string, extra: Record<string, unknown> = {}) =>
  ({ metric, aggregation, ...extra }) as AnalyticsSeries;
/** Trace metrics beside run metrics: main pre-aggregates the runs per trace (issue #3088). */
export const MIXED_SERIES: AnalyticsSeries[] = [
  mixed("performance.total_cost", "sum"),
  mixed("performance.completion_time", "avg"),
  mixed("performance.completion_time", "median"),
  mixed("performance.total_cost", "max"),
  mixed("metadata.trace_id", "cardinality"),
  mixed("metadata.user_id", "cardinality"),
  ...(["avg", "sum", "min", "max", "median", "cardinality"] as const).map((aggregation) =>
    mixed("evaluations.evaluation_score", aggregation, { key: "ev" }),
  ),
  mixed("evaluations.evaluation_pass_rate", "avg"),
  mixed("evaluations.evaluation_runs", "cardinality", { key: "ev" }),
  mixed("evaluations.evaluation_runs", "cardinality"),
];
/** A series' own filter on both sides of the mix, additive and not, and as a percentage. */
export const MIXED_FILTERED_SERIES: AnalyticsSeries[] = [
  mixed("performance.total_cost", "sum", { filters: clean }),
  mixed("metadata.trace_id", "cardinality", { filters: clean, asPercent: true }),
  mixed("evaluations.evaluation_score", "avg", { key: "ev", filters: clean }),
  mixed("evaluations.evaluation_runs", "cardinality", { filters: clean, asPercent: true }),
  mixed("evaluations.evaluation_pass_rate", "sum", { filters: clean }),
];
const MIXED_SHORT: AnalyticsSeries[] = [
  mixed("performance.total_cost", "sum"),
  mixed("metadata.trace_id", "cardinality"),
  mixed("evaluations.evaluation_score", "avg", { key: "ev" }),
  mixed("evaluations.evaluation_runs", "cardinality"),
];

/** Path A, mixed: trace and evaluation metrics in one graph. */
export const MIXED_SHAPES: Shape[] = [
  {
    name: "mixed, every metric, hourly",
    table: "trace_summaries",
    series: MIXED_SERIES,
    timeScale: 60,
  },
  {
    name: "mixed, every metric, daily in Amsterdam",
    table: "trace_summaries",
    series: MIXED_SERIES,
    timeScale: 1440,
    timeZone: "Europe/Amsterdam",
  },
  {
    name: "mixed summary, both periods",
    table: "trace_summaries",
    series: MIXED_SERIES,
    timeScale: "full",
  },
  ...["error.has_error", "topics.topics", "traces.trace_name", "metadata.user_id"].map(
    (groupBy): Shape => ({
      name: `mixed by ${groupBy}`,
      table: "trace_summaries",
      series: MIXED_SHORT,
      groupBy,
      timeScale: "full",
    }),
  ),
  {
    name: "mixed with series filters, hourly",
    table: "trace_summaries",
    series: MIXED_FILTERED_SERIES,
    timeScale: 60,
  },
  {
    name: "mixed summary with series filters, both periods",
    table: "trace_summaries",
    series: MIXED_FILTERED_SERIES,
    timeScale: "full",
  },
  {
    name: "mixed filtered on evaluations.passed",
    table: "trace_summaries",
    series: MIXED_SHORT,
    filters: { "evaluations.passed": { ev: ["false"] } } as AnalyticsFilters,
    timeScale: 60,
  },
  {
    name: "mixed filtered on spans.type, negated, both periods",
    table: "trace_summaries",
    series: MIXED_SHORT,
    filters: { "spans.type": ["tool"] } as AnalyticsFilters,
    negateFilters: true,
    timeScale: "full",
  },
  {
    name: "mixed for two traces, excluding evaluation origins",
    table: "trace_summaries",
    series: MIXED_SHORT,
    traceIds: [`trace-${RUN}-0`, `trace-${RUN}-1`, `trace-${RUN}-4`],
    excludeOrigins: ["evaluation"],
    timeScale: 60,
  },
];

const graded = (aggregation: string, extra: Record<string, unknown> = {}) =>
  mixed("events.event_score", aggregation, {
    key: "graded",
    subkey: "event.metrics.score",
    ...extra,
  });
/** Span metrics on the joined spans: tokens, events, votes, and a trace metric fanned out. */
export const JOINED_SPAN_SERIES: AnalyticsSeries[] = [
  mixed("events.event_type", "cardinality", { key: "thumbs_up_down" }),
  mixed("events.event_type", "cardinality"),
  ...(["avg", "sum", "min", "max", "median", "p90"] as const).map((aggregation) =>
    graded(aggregation),
  ),
  mixed("sentiment.thumbs_up_down", "cardinality"),
  mixed("sentiment.thumbs_up_down", "sum"),
  mixed("sentiment.thumbs_up_down", "avg"),
  mixed("performance.total_cost", "sum"),
  mixed("metadata.trace_id", "cardinality"),
];
const JOINED_FILTERED_SERIES: AnalyticsSeries[] = [
  graded("sum", { filters: clean }),
  graded("median", { filters: clean }),
  mixed("sentiment.thumbs_up_down", "sum", { filters: clean, asPercent: true }),
  mixed("events.event_type", "cardinality", { filters: clean }),
];
/** Span token usage: main summed the attribute's string and failed, so no main answer exists. */
export const SPAN_TOKEN_SHAPE: Shape = {
  name: "joined span tokens, hourly",
  table: "trace_summaries",
  series: [
    mixed("spans.metrics.prompt_tokens", "sum"),
    mixed("spans.metrics.completion_tokens", "avg"),
  ],
  timeScale: 60,
};
const RUN_SERIES: AnalyticsSeries[] = [
  mixed("evaluations.evaluation_score", "avg", { key: "ev" }),
  mixed("evaluations.evaluation_runs", "cardinality"),
  mixed("evaluations.evaluation_pass_rate", "avg"),
];
const TRACE_SHORT: AnalyticsSeries[] = [
  mixed("performance.total_cost", "sum"),
  mixed("metadata.trace_id", "cardinality"),
];
const RUN_GROUPINGS: [string, string | undefined][] = [
  ["evaluations.evaluation_passed", undefined],
  ["evaluations.evaluation_passed", "ev"],
  ["evaluations.evaluation_label", undefined],
  ["evaluations.evaluation_label", "ev"],
  ["evaluations.evaluation_processing_state", undefined],
];

/** Path A, joined: trace_summaries joined to its spans or runs, every joined row counted. */
export const JOINED_SHAPES: Shape[] = [
  {
    name: "joined spans, every metric, hourly",
    table: "trace_summaries",
    series: JOINED_SPAN_SERIES,
    timeScale: 60,
  },
  {
    name: "joined spans, every metric, daily in Amsterdam",
    table: "trace_summaries",
    series: JOINED_SPAN_SERIES,
    timeScale: 1440,
    timeZone: "Europe/Amsterdam",
  },
  {
    name: "joined spans by metadata.user_id, both periods",
    table: "trace_summaries",
    series: JOINED_SPAN_SERIES,
    groupBy: "metadata.user_id",
    timeScale: "full",
  },
  {
    name: "joined spans with series filters, hourly",
    table: "trace_summaries",
    series: JOINED_FILTERED_SERIES,
    timeScale: 60,
  },
  {
    name: "joined spans filtered on spans.type, negated",
    table: "trace_summaries",
    series: JOINED_FILTERED_SERIES,
    filters: { "spans.type": ["tool"] } as AnalyticsFilters,
    negateFilters: true,
    timeScale: 60,
  },
  {
    name: "joined spans for two traces, excluding evaluation origins",
    table: "trace_summaries",
    series: JOINED_SPAN_SERIES,
    traceIds: [`trace-${RUN}-0`, `trace-${RUN}-1`, `trace-${RUN}-4`],
    excludeOrigins: ["evaluation"],
    timeScale: 60,
  },
  {
    name: "joined runs by topics.topics, hourly",
    table: "trace_summaries",
    series: RUN_SERIES,
    groupBy: "topics.topics",
    timeScale: 60,
  },
  ...RUN_GROUPINGS.flatMap(([groupBy, groupByKey]): Shape[] => [
    {
      name: `joined runs by ${groupBy}${groupByKey ? ` of ${groupByKey}` : ""}, both periods`,
      table: "trace_summaries",
      series: RUN_SERIES,
      groupBy,
      groupByKey,
      timeScale: "full",
    },
    {
      name: `joined traces by ${groupBy}${groupByKey ? ` of ${groupByKey}` : ""}, hourly`,
      table: "trace_summaries",
      series: TRACE_SHORT,
      groupBy,
      groupByKey,
      timeScale: 60,
    },
  ]),
  {
    name: "joined spans and runs by evaluations.evaluation_passed, hourly",
    table: "trace_summaries",
    series: [mixed("sentiment.thumbs_up_down", "cardinality"), graded("max")],
    groupBy: "evaluations.evaluation_passed",
    timeScale: 60,
  },
];

const SPAN_GROUPINGS = [
  "metadata.labels",
  "metadata.span_type",
  "events.event_type",
  "sentiment.thumbs_up_down",
];

/** Per-trace pipelines, which main read as their inner metric under these groupings. */
const PER_TRACE_PIPELINES: AnalyticsSeries[] = [
  mixed("performance.total_cost", "sum", { pipeline: { field: "trace_id", aggregation: "avg" } }),
  mixed("performance.completion_time", "avg", {
    pipeline: { field: "trace_id", aggregation: "max" },
    filters: clean,
  }),
  mixed("performance.total_cost", "max", { pipeline: { field: "trace_id", aggregation: "sum" } }),
  mixed("metadata.trace_id", "cardinality"),
];

/** Path A, span-grouped: trace metrics by a key a trace holds several of, once per trace, key. */
export const SPAN_GROUPED_SHAPES: Shape[] = [
  ...SPAN_GROUPINGS.flatMap((groupBy): Shape[] => [
    {
      name: `span-grouped by ${groupBy}, every metric, hourly`,
      table: "trace_summaries",
      series: SUMMARY_SERIES,
      groupBy,
      timeScale: 60,
    },
    {
      name: `span-grouped by ${groupBy}, both periods`,
      table: "trace_summaries",
      series: SLIM_SHORT,
      groupBy,
      timeScale: "full",
    },
    {
      name: `span-grouped by ${groupBy}, series filters, daily in Amsterdam`,
      table: "trace_summaries",
      series: SUMMARY_FILTERED_SERIES,
      groupBy,
      timeScale: 1440,
      timeZone: "Europe/Amsterdam",
    },
  ]),
  ...["metadata.labels", "metadata.span_type"].map((groupBy): Shape => ({
    name: `span-grouped per-trace pipelines by ${groupBy}, hourly`,
    table: "trace_summaries",
    series: PER_TRACE_PIPELINES,
    groupBy,
    timeScale: 60,
  })),
  {
    name: "span-grouped by metadata.labels, filtered on two labels",
    table: "trace_summaries",
    series: SLIM_SHORT,
    filters: { "metadata.labels": both((t) => `${t}-label-0`) },
    groupBy: "metadata.labels",
    timeScale: 60,
  },
  {
    name: "span-grouped by metadata.span_type, filtered on spans.type, negated",
    table: "trace_summaries",
    series: SLIM_SHORT,
    filters: { "spans.type": ["tool"] } as AnalyticsFilters,
    negateFilters: true,
    groupBy: "metadata.span_type",
    timeScale: "full",
  },
  {
    name: "span-grouped by events.event_type, for three traces, excluding evaluation origins",
    table: "trace_summaries",
    series: SLIM_SHORT,
    traceIds: [`trace-${RUN}-0`, `trace-${RUN}-1`, `trace-${RUN}-4`],
    excludeOrigins: ["evaluation"],
    groupBy: "events.event_type",
    timeScale: 60,
  },
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
  ...SUMMARY_SHAPES,
];
