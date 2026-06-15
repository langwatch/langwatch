/**
 * Integration coverage for the topic-clustering trace-counts query against a
 * real ClickHouse.
 *
 * `fetchCountsFromClickHouse` returns total / recent (last 30d) / assigned
 * (has a topic) counts over the last 12 months. trace_summaries is a
 * ReplacingMergeTree, so each trace must be counted once at its *latest*
 * version. These tests lock in that the single-pass argMax fold reads the
 * latest version's OccurredAt / TopicId — including the case where a stale
 * older version would otherwise change the count.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { fetchCountsFromClickHouse } from "../topicClustering";

const TENANT_ID = `topic-counts-test-${nanoid(6)}`;

const DAY = 24 * 60 * 60 * 1000;

type TraceRow = Record<string, unknown>;

function traceRow(opts: {
  traceId: string;
  occurredAtMs: number;
  updatedAtMs: number;
  topicId: string | null;
}): TraceRow {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: TENANT_ID,
    TraceId: opts.traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(opts.occurredAtMs),
    CreatedAt: new Date(opts.occurredAtMs),
    UpdatedAt: new Date(opts.updatedAtMs),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TimeToFirstTokenMs: 1,
    TimeToLastTokenMs: 1,
    TotalDurationMs: 1,
    TokensPerSecond: 1,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: ["gpt-5-mini"],
    TotalCost: 0.01,
    TokensEstimated: false,
    TotalPromptTokenCount: 1,
    TotalCompletionTokenCount: 1,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: opts.topicId,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

describe("fetchCountsFromClickHouse integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const raw = getTestClickHouseClient();
    if (!raw) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(raw);

    const now = Date.now();
    const rows: TraceRow[] = [
      // A: latest version is recent (5d) AND assigned. A stale older version
      // (200d, no topic) must NOT win the dedup.
      traceRow({
        traceId: `${TENANT_ID}-A`,
        occurredAtMs: now - 200 * DAY,
        updatedAtMs: now - 200 * DAY,
        topicId: null,
      }),
      traceRow({
        traceId: `${TENANT_ID}-A`,
        occurredAtMs: now - 5 * DAY,
        updatedAtMs: now - 5 * DAY,
        topicId: "topic-1",
      }),
      // B: single version, old (90d, within 12mo) and unassigned.
      traceRow({
        traceId: `${TENANT_ID}-B`,
        occurredAtMs: now - 90 * DAY,
        updatedAtMs: now - 90 * DAY,
        topicId: null,
      }),
      // C: single version, recent (10d) and unassigned.
      traceRow({
        traceId: `${TENANT_ID}-C`,
        occurredAtMs: now - 10 * DAY,
        updatedAtMs: now - 10 * DAY,
        topicId: "",
      }),
      // D: outside the 12-month window — excluded entirely.
      traceRow({
        traceId: `${TENANT_ID}-D`,
        occurredAtMs: now - 400 * DAY,
        updatedAtMs: now - 400 * DAY,
        topicId: "topic-2",
      }),
      // E: latest version CLEARS the topic (recent). A stale older version
      // (also recent) had a topic. The latest wins, so E is recent but NOT
      // assigned — guards against argMax skipping the NULL latest TopicId and
      // folding to the stale non-null one.
      traceRow({
        traceId: `${TENANT_ID}-E`,
        occurredAtMs: now - 5 * DAY,
        updatedAtMs: now - 5 * DAY,
        topicId: "topic-3",
      }),
      traceRow({
        traceId: `${TENANT_ID}-E`,
        occurredAtMs: now - 1 * DAY,
        updatedAtMs: now - 1 * DAY,
        topicId: null,
      }),
    ];

    await ch.insert({
      table: "trace_summaries",
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 120_000);

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);
  });

  describe("given traces across recency, assignment, and version dimensions", () => {
    describe("when counting total / recent / assigned", () => {
      it("counts each trace once at its latest version", async () => {
        const counts = await fetchCountsFromClickHouse({
          clickhouse: ch,
          projectId: TENANT_ID,
        });

        // A, B, C, E are within 12 months; D is excluded.
        expect(counts.totalTracesCount).toBe(4);
        // A (5d), C (10d), E (1d) are within 30 days; B (90d) is not.
        expect(counts.recentTracesCount).toBe(3);
        // Only A's latest version carries a non-empty TopicId. C's "", the
        // stale A version's null, and E's latest-cleared null must not count.
        expect(counts.assignedTracesCount).toBe(1);
      });
    });
  });
});
