/**
 * Seed data for `error-series.integration.test.ts` (#6718): five traces split
 * across error status and span type, three of them evaluated. Pure fixture
 * construction — the suite next door owns every assertion.
 */

import type { FlattenAnalyticsMetricsEnum } from "../../registry";

export const TENANT_ID = "test-error-series-6718";

/** Anchor an hour back so every seeded row sits inside the current window. */
export const T0 = Date.now() - 60 * 60 * 1000;

export const WINDOW = {
  projectId: TENANT_ID,
  startDate: new Date(T0 - 24 * 60 * 60 * 1000),
  endDate: new Date(T0 + 24 * 60 * 60 * 1000),
  previousPeriodStartDate: new Date(T0 - 48 * 60 * 60 * 1000),
  timeScale: "full" as const,
};

/** A window that deliberately contains none of the seeded traces. */
export const EMPTY_WINDOW = {
  ...WINDOW,
  startDate: new Date(T0 - 400 * 24 * 60 * 60 * 1000),
  endDate: new Date(T0 - 399 * 24 * 60 * 60 * 1000),
  previousPeriodStartDate: new Date(T0 - 401 * 24 * 60 * 60 * 1000),
};

/**
 * Two traces carry an error, three do not. Two carry an `llm` span (one of each
 * error status) so a span-facet filter can be told apart from the error one.
 * Error traces run LONGER than clean ones, so a duration aggregate over the
 * error subset answers differently from one over the whole window — an
 * assertion on it fails if the series filter is dropped.
 */
export const TRACES = [
  { id: "err-0", hasError: true, spanType: "llm", durationMs: 350 },
  { id: "err-1", hasError: true, spanType: "agent", durationMs: 450 },
  { id: "ok-0", hasError: false, spanType: "llm", durationMs: 200 },
  { id: "ok-1", hasError: false, spanType: "agent", durationMs: 200 },
  { id: "ok-2", hasError: false, spanType: "agent", durationMs: 200 },
] as const;

export const TRACES_WITH_ERROR = TRACES.filter((t) => t.hasError).length;
export const TRACES_TOTAL = TRACES.length;
export const ERROR_TRACES_MIN_DURATION_MS = Math.min(
  ...TRACES.filter((t) => t.hasError).map((t) => t.durationMs),
);

export const traceCount = (index: number) => ({
  metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
  aggregation: "cardinality" as const,
  alias: `${index}__metadata_trace_id__cardinality`,
});

/** Traces the evaluation-run fixtures cover, and the score each one carries. */
export const EVALUATED = [
  { id: "err-0", score: 0.2 },
  { id: "err-1", score: 0.4 },
  { id: "ok-0", score: 0.9 },
] as const;

export const EVALUATED_WITH_ERROR = EVALUATED.filter((evaluated) =>
  TRACES.some((trace) => trace.id === evaluated.id && trace.hasError),
).length;

export const EVALUATOR_ID = `${TENANT_ID}-evaluator`;

export function evaluationRunRow(evaluated: (typeof EVALUATED)[number]) {
  return {
    ProjectionId: `proj-eval-${TENANT_ID}-${evaluated.id}`,
    TenantId: TENANT_ID,
    EvaluationId: `eval-${TENANT_ID}-${evaluated.id}`,
    Version: "1",
    EvaluatorId: EVALUATOR_ID,
    EvaluatorType: "custom",
    TraceId: `${TENANT_ID}-${evaluated.id}`,
    Status: "processed",
    Score: evaluated.score,
    Passed: 1,
    Label: "PASS",
    LastProcessedEventId: `evt-${TENANT_ID}-${evaluated.id}`,
    UpdatedAt: new Date(T0).toISOString(),
  };
}

export function traceSummaryRow(trace: (typeof TRACES)[number]) {
  return {
    ProjectionId: `proj-${TENANT_ID}-${trace.id}`,
    TenantId: TENANT_ID,
    TraceId: `${TENANT_ID}-${trace.id}`,
    Version: "v1",
    Attributes: { "metadata.env": "test" },
    OccurredAt: new Date(T0),
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TimeToFirstTokenMs: 50,
    TimeToLastTokenMs: trace.durationMs,
    TotalDurationMs: trace.durationMs,
    TokensPerSecond: 100,
    SpanCount: 1,
    ContainsErrorStatus: trace.hasError ? 1 : 0,
    ContainsOKStatus: trace.hasError ? 0 : 1,
    ErrorMessage: trace.hasError ? "boom" : null,
    Models: ["gpt-5-mini"],
    TotalCost: 1,
    TokensEstimated: false,
    TotalPromptTokenCount: 100,
    TotalCompletionTokenCount: 10,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

export function storedSpanRow(trace: (typeof TRACES)[number]) {
  return {
    ProjectionId: `proj-span-${TENANT_ID}-${trace.id}`,
    TenantId: TENANT_ID,
    TraceId: `${TENANT_ID}-${trace.id}`,
    SpanId: `${TENANT_ID}-${trace.id}-span`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(T0),
    EndTime: new Date(T0 + trace.durationMs),
    DurationMs: trace.durationMs,
    SpanName: trace.id,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: { "langwatch.span.type": trace.spanType },
    StatusCode: trace.hasError ? 2 : 1,
    StatusMessage: "",
    ScopeName: "",
    ScopeVersion: null,
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    Cost: null,
    NonBilledCost: null,
  };
}
