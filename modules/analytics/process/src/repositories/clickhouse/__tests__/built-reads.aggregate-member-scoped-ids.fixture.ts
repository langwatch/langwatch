/**
 * Seed rows and reads for the aggregate's member-scoped id cases: one trace each for two members
 * and an outsider, all on the same conversation and user. Merged on the bare id they would read
 * as one thread of two messages; the outsider sits inside the gap, so a leak shows (ADR-177).
 */
import { randomUUID } from "node:crypto";

import type {
  AnalyticsSeries,
  AnalyticsTable,
  AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import { buildSeriesName } from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import { Temporal } from "@langwatch/time";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import type { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";

const RUN = randomUUID();
const AGGREGATE = `test-agg-ids-${RUN}`;
export const MEMBER_A = `test-agg-ids-a-${RUN}`;
const MEMBER_B = `test-agg-ids-b-${RUN}`;
const FOREIGN = `test-agg-ids-foreign-${RUN}`;
export const TENANTS = [MEMBER_A, MEMBER_B, FOREIGN];
export const SEEDED_TABLES = ["trace_summaries", "trace_analytics"];
const CONVERSATION = `conversation-${RUN}`;
const USER = `user-${RUN}`;

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);

const TRACES: { tenantId: string; time: string }[] = [
  { tenantId: MEMBER_A, time: "10:00:00.000" },
  { tenantId: FOREIGN, time: "10:00:00.050" },
  { tenantId: MEMBER_B, time: "10:00:00.117" },
];

const traceIdOf = (index: number) => `trace-${RUN}-${index}`;

function traceSummaryRow({ tenantId, time }: (typeof TRACES)[number], index: number) {
  const occurredAt = new Date(at(time).epochMilliseconds);
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    Version: "v1",
    Attributes: { "gen_ai.conversation.id": CONVERSATION, "langwatch.user_id": USER },
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

function traceAnalyticsRow({ tenantId, time }: (typeof TRACES)[number], index: number) {
  const occurredAt = new Date(at(time).epochMilliseconds);
  return {
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    Version: "2026-10-05",
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: occurredAt,
    TraceName: "shared conversation trace",
    Origin: "",
    Models: [],
    Labels: [],
    UserId: USER,
    ConversationId: CONVERSATION,
    TotalCost: 1,
    TotalDurationMs: 100,
    HasError: false,
    SpanCount: 1,
    EarliestSpanStartMs: occurredAt.getTime(),
    Attributes: {},
  };
}

export const seeds = () => [
  { table: "trace_summaries", values: TRACES.map(traceSummaryRow) },
  { table: "trace_analytics", values: TRACES.map(traceAnalyticsRow) },
];

/** The Analytics "Thread metrics" card, as one read. */
export const THREADS_COUNT: AnalyticsSeries = {
  metric: "metadata.thread_id",
  aggregation: "cardinality",
};
export const MESSAGES_PER_THREAD: AnalyticsSeries = {
  metric: "metadata.trace_id",
  aggregation: "cardinality",
  pipeline: { field: "thread_id", aggregation: "avg" },
};
export const THREAD_DURATION: AnalyticsSeries = {
  metric: "threads.average_duration_per_thread",
  aggregation: "avg",
};
/** The Users page's per-user thread duration. */
export const USER_THREAD_DURATION: AnalyticsSeries = {
  metric: "threads.average_duration_per_thread",
  aggregation: "avg",
  pipeline: { field: "user_id", aggregation: "avg" },
};
export const USERS_COUNT: AnalyticsSeries = {
  metric: "metadata.user_id",
  aggregation: "cardinality",
};

/** The series over the whole day, as the project's dashboard asks it. */
export function seriesRead({
  projectId = AGGREGATE,
  authorization,
  table,
  series,
}: {
  projectId?: string;
  authorization: Authorization;
  table: AnalyticsTable;
  series: AnalyticsSeries[];
}): Parameters<ClickHouseAnalyticsRepository["runTimeseries"]>[0] {
  const startDate = at("06:00:00");
  const endDate = at("14:00:00");
  return {
    table,
    authorization,
    input: {
      projectId,
      startDate: startDate.epochMilliseconds,
      endDate: endDate.epochMilliseconds,
      filters: {},
      series,
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

/** Each series' value over the one `full` bucket, by its position in the read. */
export function values(result: AnalyticsTimeseriesResult, series: AnalyticsSeries[]): number[] {
  return series.map((s, index) =>
    result.currentPeriod.reduce(
      (sum, bucket) => sum + Number(bucket[buildSeriesName(s, index)] ?? 0),
      0,
    ),
  );
}

export const groupProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [
      { projectId: MEMBER_A, from: 0 },
      { projectId: MEMBER_B, from: 0 },
    ],
  });
