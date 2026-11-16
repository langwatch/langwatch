/**
 * Seed rows and reads for the cost-gated aggregate-window cases (top documents, feedbacks): one
 * trace per row, its name the document it cites and the feedback span it carries (ADR-177 v4.15).
 */
import { randomUUID } from "node:crypto";

import { Temporal } from "@langwatch/time";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";

const RUN = randomUUID();
export const AGGREGATE = `test-agg-cost-${RUN}`;
export const WHOLE_HISTORY_MEMBER = `test-agg-cost-a-${RUN}`;
const LATE_MEMBER = `test-agg-cost-b-${RUN}`;
const FOREIGN = `test-agg-cost-foreign-${RUN}`;
export const TENANTS = [AGGREGATE, WHOLE_HISTORY_MEMBER, LATE_MEMBER, FOREIGN];
export const SEEDED_TABLES = ["trace_summaries", "stored_spans"];

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
const dateOf = (time: string) => new Date(at(time).epochMilliseconds);
const LATE_MEMBER_FROM = at("10:00:00");

const TRACES: { tenantId: string; time: string; name: string }[] = [
  { tenantId: WHOLE_HISTORY_MEMBER, time: "08:00:00", name: "a-early" },
  { tenantId: WHOLE_HISTORY_MEMBER, time: "11:00:00", name: "a-late" },
  { tenantId: LATE_MEMBER, time: "09:30:00", name: "b-before-grant" },
  { tenantId: LATE_MEMBER, time: "10:30:00", name: "b-in-grant" },
  { tenantId: FOREIGN, time: "10:30:00", name: "foreign" },
];
export const IN_WINDOWS = ["a-early", "a-late", "b-in-grant"];

const traceIdOf = (index: number) => `trace-${RUN}-${index}`;

function traceSummaryRow({ tenantId, time }: (typeof TRACES)[number], index: number) {
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    Version: "v1",
    Attributes: {},
    OccurredAt: dateOf(time),
    CreatedAt: dateOf(time),
    UpdatedAt: dateOf(time),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    Models: [],
  };
}

function storedSpanRow({ tenantId, time, name }: (typeof TRACES)[number], index: number) {
  return {
    ProjectionId: `proj-span-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    SpanId: name,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: dateOf(time),
    EndTime: dateOf(time),
    DurationMs: 1,
    SpanName: "rag",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {
      "langwatch.rag.contexts": JSON.stringify([{ document_id: name, content: name }]),
    },
    StatusCode: 1,
    StatusMessage: "",
    ScopeName: "",
    ScopeVersion: null,
    "Events.Timestamp": [dateOf(time).toISOString()],
    "Events.Name": ["thumbs_up_down"],
    "Events.Attributes": [{ "event.metrics.vote": "1" }],
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

export const seeds = () => [
  { table: "trace_summaries", values: TRACES.map(traceSummaryRow) },
  { table: "stored_spans", values: TRACES.map(storedSpanRow) },
];

/** Member A shared for its whole history, member B only from its grant's start. */
export const read = (projectId = AGGREGATE) => ({
  authorization: analyticsProof({
    projectId,
    permission: "cost:view",
    shared:
      projectId === AGGREGATE
        ? [
            { projectId: WHOLE_HISTORY_MEMBER, from: 0 },
            { projectId: LATE_MEMBER, from: LATE_MEMBER_FROM.epochMilliseconds },
          ]
        : [],
  }),
  projectId,
  startDate: at("06:00:00").epochMilliseconds,
  endDate: at("14:00:00").epochMilliseconds,
  filters: {},
});
