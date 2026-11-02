import { randomUUID } from "node:crypto";

/**
 * Two members of an aggregate can hold the same thread or user id. The aggregate's thread and
 * user metrics key each id by its member, so the two stay two threads, and a project outside
 * the proof sharing the id is never one of them (ADR-177).
 * @see specs/governance/aggregate-project.feature
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  buildSeriesName,
  type AnalyticsSeries,
  type AnalyticsTable,
  type AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";
import { clickHouseQueryClientOver } from "./support/clickhouse-query-client.support.ts";

const RUN = randomUUID();
const AGGREGATE = `test-agg-ids-${RUN}`;
const MEMBER_A = `test-agg-ids-a-${RUN}`;
const MEMBER_B = `test-agg-ids-b-${RUN}`;
const FOREIGN = `test-agg-ids-foreign-${RUN}`;
const SEEDED_TABLES = ["trace_summaries", "trace_analytics"] as const;
const CONVERSATION = `conversation-${RUN}`;
const USER = `user-${RUN}`;

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);

/**
 * One trace each, all on the same conversation and user. Merged on the bare id they would read
 * as one thread of two messages lasting the gap between A and B; the foreign trace sits inside
 * that gap so a leak would show as a third message.
 */
const TRACES: { tenantId: string; time: string }[] = [
  { tenantId: MEMBER_A, time: "10:00:00.000" },
  { tenantId: FOREIGN, time: "10:00:00.050" },
  { tenantId: MEMBER_B, time: "10:00:00.117" },
];

let client: ClickHouseClient;
let repository: ClickHouseAnalyticsRepository;

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

/** The Analytics "Thread metrics" card, as one read. */
const THREADS_COUNT: AnalyticsSeries = { metric: "metadata.thread_id", aggregation: "cardinality" };
const MESSAGES_PER_THREAD: AnalyticsSeries = {
  metric: "metadata.trace_id",
  aggregation: "cardinality",
  pipeline: { field: "thread_id", aggregation: "avg" },
};
const THREAD_DURATION: AnalyticsSeries = {
  metric: "threads.average_duration_per_thread",
  aggregation: "avg",
};
/** The Users page's per-user thread duration. */
const USER_THREAD_DURATION: AnalyticsSeries = {
  metric: "threads.average_duration_per_thread",
  aggregation: "avg",
  pipeline: { field: "user_id", aggregation: "avg" },
};
const USERS_COUNT: AnalyticsSeries = { metric: "metadata.user_id", aggregation: "cardinality" };

function read({
  projectId = AGGREGATE,
  authorization,
  table,
  series,
}: {
  projectId?: string;
  authorization: Authorization;
  table: AnalyticsTable;
  series: AnalyticsSeries[];
}): Promise<AnalyticsTimeseriesResult> {
  const startDate = at("06:00:00");
  const endDate = at("14:00:00");
  return repository.runTimeseries({
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
  });
}

/** Each series' value over the one `full` bucket, by its position in the read. */
function values(result: AnalyticsTimeseriesResult, series: AnalyticsSeries[]): number[] {
  return series.map((s, index) =>
    result.currentPeriod.reduce(
      (sum, bucket) => sum + Number(bucket[buildSeriesName(s, index)] ?? 0),
      0,
    ),
  );
}

const groupProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [
      { projectId: MEMBER_A, from: 0 },
      { projectId: MEMBER_B, from: 0 },
    ],
  });

beforeAll(async () => {
  client = (await startMigratedClickHouse()).client;
  repository = ClickHouseAnalyticsRepository.create({
    clickhouse: clickHouseQueryClientOver(client),
  });
  const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
  await client.insert({
    table: "trace_summaries",
    values: TRACES.map(traceSummaryRow),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await client.insert({
    table: "trace_analytics",
    values: TRACES.map(traceAnalyticsRow),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 300_000);

afterAll(async () => {
  for (const tenantId of [MEMBER_A, MEMBER_B, FOREIGN]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: SEEDED_TABLES });
  }
});

describe("thread and user metrics under an aggregate's proof", () => {
  describe("given two members and an outsider on the same conversation and user id", () => {
    describe("when the thread metrics card reads the group", () => {
      it("counts each member's thread as its own, one message each, never the outsider's", async () => {
        const series = [THREADS_COUNT, MESSAGES_PER_THREAD, THREAD_DURATION];
        const result = await read({
          authorization: groupProof(),
          table: "trace_summaries",
          series,
        });

        expect(values(result, series)).toEqual([2, 1, 0]);
      });
    });

    describe("when the users page reads the group", () => {
      it("keeps one user per member, each with its own zero-length thread", async () => {
        const series = [USERS_COUNT, USER_THREAD_DURATION];
        const result = await read({
          authorization: groupProof(),
          table: "trace_summaries",
          series,
        });

        expect(values(result, series)).toEqual([2, 0]);
      });
    });

    describe("when the slim table serves the counts", () => {
      it("counts each member's thread and user as its own", async () => {
        const series = [THREADS_COUNT, USERS_COUNT];
        const result = await read({
          authorization: groupProof(),
          table: "trace_analytics",
          series,
        });

        expect(values(result, series)).toEqual([2, 2]);
      });
    });
  });

  describe("given a plain project's proof", () => {
    it("reads its one thread of one message, as before", async () => {
      const series = [THREADS_COUNT, MESSAGES_PER_THREAD, THREAD_DURATION, USERS_COUNT];
      const result = await read({
        projectId: MEMBER_A,
        authorization: analyticsProof({ projectId: MEMBER_A }),
        table: "trace_summaries",
        series,
      });

      expect(values(result, series)).toEqual([1, 1, 0, 1]);
    });

    it("counts its one thread and user on the slim table, as before", async () => {
      const series = [THREADS_COUNT, USERS_COUNT];
      const result = await read({
        projectId: MEMBER_A,
        authorization: analyticsProof({ projectId: MEMBER_A }),
        table: "trace_analytics",
        series,
      });

      expect(values(result, series)).toEqual([1, 1]);
    });
  });
});
