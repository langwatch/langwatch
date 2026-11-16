/**
 * Seed rows and proofs for the aggregate's filter-picker window cases: one trace per row, its
 * user, model and evaluator name saying which row a picker offered. An evaluation runs when its
 * trace occurred unless `evaluatedAt` says later (ADR-177 v4.15).
 */
import { randomUUID } from "node:crypto";

import { Temporal } from "@langwatch/time";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";

const RUN = randomUUID();
const AGGREGATE = `test-agg-filters-${RUN}`;
export const WHOLE_HISTORY_MEMBER = `test-agg-filters-a-${RUN}`;
const LATE_MEMBER = `test-agg-filters-b-${RUN}`;
const FOREIGN = `test-agg-filters-foreign-${RUN}`;
const CLOSED_MEMBER = `test-agg-filters-c-${RUN}`;
export const TENANTS = [AGGREGATE, WHOLE_HISTORY_MEMBER, LATE_MEMBER, FOREIGN, CLOSED_MEMBER];
export const SEEDED_TABLES = ["trace_summaries", "stored_spans", "evaluation_runs"];
export const EVALUATOR = `${RUN}-check`;

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
const LATE_MEMBER_FROM = at("10:00:00");
const CLOSED_MEMBER_UNTIL = at("12:00:00");
export const START = at("06:00:00");
export const END = at("14:00:00");

/** A trace id two members both carry, as ids from different projects can collide. */
const SHARED_TRACE_ID = `trace-${RUN}-shared`;

const TRACES: {
  tenantId: string;
  time: string;
  name: string;
  traceId?: string;
  evaluatedAt?: string;
}[] = [
  { tenantId: WHOLE_HISTORY_MEMBER, time: "08:00:00", name: "a-early" },
  { tenantId: WHOLE_HISTORY_MEMBER, time: "11:00:00", name: "a-late" },
  { tenantId: LATE_MEMBER, time: "09:30:00", name: "b-before-grant" },
  { tenantId: LATE_MEMBER, time: "10:30:00", name: "b-in-grant" },
  { tenantId: FOREIGN, time: "10:30:00", name: "foreign" },
  {
    tenantId: LATE_MEMBER,
    time: "09:00:00",
    name: "b-before-grant-evaluated-after",
    evaluatedAt: "10:45:00",
  },
  { tenantId: WHOLE_HISTORY_MEMBER, time: "11:30:00", name: "a-shared", traceId: SHARED_TRACE_ID },
  { tenantId: LATE_MEMBER, time: "11:30:00", name: "b-shared", traceId: SHARED_TRACE_ID },
  { tenantId: CLOSED_MEMBER, time: "11:50:00", name: "c-closed", evaluatedAt: "12:10:00" },
];
export const IN_WINDOWS = ["a-early", "a-late", "a-shared", "b-in-grant", "b-shared"];

const traceIdOf = (index: number) => TRACES[index]?.traceId ?? `trace-${RUN}-${index}`;
const dateOf = (time: string) => new Date(at(time).epochMilliseconds);

function traceSummaryRow({ tenantId, time, name }: (typeof TRACES)[number], index: number) {
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    Version: "v1",
    Attributes: { "langwatch.user_id": name },
    OccurredAt: dateOf(time),
    CreatedAt: dateOf(time),
    UpdatedAt: dateOf(time),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TotalDurationMs: 200,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: [name],
    TotalCost: 1,
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

function storedSpanRow({ tenantId, time, name }: (typeof TRACES)[number], index: number) {
  return {
    ProjectionId: `proj-span-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    SpanId: `span-${RUN}-${index}`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: dateOf(time),
    EndTime: dateOf(time),
    DurationMs: 1,
    SpanName: name,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: { "langwatch.span.type": name },
    StatusCode: 1,
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

function evaluationRunRow(
  { tenantId, time, name, evaluatedAt }: (typeof TRACES)[number],
  index: number,
) {
  const scheduledAt = dateOf(evaluatedAt ?? time).toISOString();
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${randomUUID()}`,
    Version: "1",
    EvaluatorId: `${EVALUATOR}-${name}`,
    EvaluatorName: name,
    EvaluatorType: "langevals/exact_match",
    TraceId: traceIdOf(index),
    Status: "processed",
    Score: 1,
    Passed: 1,
    Label: null,
    LastProcessedEventId: `evt-${randomUUID()}`,
    ScheduledAt: scheduledAt,
    UpdatedAt: scheduledAt,
  };
}

export const seeds = () => [
  { table: "trace_summaries", values: TRACES.map(traceSummaryRow) },
  { table: "stored_spans", values: TRACES.map(storedSpanRow) },
  { table: "evaluation_runs", values: TRACES.map(evaluationRunRow) },
];

/** Member A shared for its whole history, member B only from its grant's start. */
export const aggregateProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [
      { projectId: WHOLE_HISTORY_MEMBER, from: 0 },
      { projectId: LATE_MEMBER, from: LATE_MEMBER_FROM.epochMilliseconds },
    ],
  });

/** A member shared until noon: its 11:50 trace is in the window, its 12:10 evaluation is not. */
export const closedShareProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [{ projectId: CLOSED_MEMBER, from: 0, until: CLOSED_MEMBER_UNTIL.epochMilliseconds }],
  });
