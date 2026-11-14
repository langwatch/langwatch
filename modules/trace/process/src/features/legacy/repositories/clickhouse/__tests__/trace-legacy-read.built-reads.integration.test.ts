/**
 * The legacy reads that take no filter, built (ADR-202) and run on a migrated 26.8 server as the
 * reader with the tenant setting: the thread lookups, topic counts, customers and labels.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  authorizedClickHouseFor,
  traceQueryClientFor,
} from "../../../../../repositories/clickhouse/__tests__/support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `test-legacy-built-${nanoid()}`;
const otherTenantId = `test-legacy-built-other-${nanoid()}`;
const now = Date.now();

function summary({
  tenant = tenantId,
  traceId,
  attributes = {},
  topicId = null,
  createdAt = now,
}: {
  tenant?: string;
  traceId: string;
  attributes?: Record<string, string>;
  topicId?: string | null;
  createdAt?: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    TraceId: traceId,
    Version: "v1",
    Attributes: attributes,
    OccurredAt: new Date(now),
    CreatedAt: new Date(createdAt),
    UpdatedAt: new Date(now),
    TopicId: topicId,
  };
}

let ch: ClickHouseClient;
let repository: TraceLegacyReadClickHouseRepository;

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repository = TraceLegacyReadClickHouseRepository.create({
    resolveClickHouseClient: async () => ch,
    clickhouse: authorizedClickHouseFor(ch),
    reader: traceQueryClientFor(ch),
  });
  await ch.insert({
    table: "trace_summaries",
    values: [
      summary({
        traceId: "trace-b",
        attributes: { "gen_ai.conversation.id": "thread-1", "langwatch.customer_id": "cust-1" },
        topicId: "topic-1",
        createdAt: now - 1_000,
      }),
      summary({
        traceId: "trace-a",
        attributes: { "gen_ai.conversation.id": "thread-1", "langwatch.labels": '["red"]' },
        topicId: "topic-1",
        createdAt: now - 2_000,
      }),
      summary({
        traceId: "trace-c",
        attributes: { "gen_ai.conversation.id": "thread-2" },
      }),
      summary({
        tenant: otherTenantId,
        traceId: "trace-other",
        attributes: { "gen_ai.conversation.id": "thread-1", "langwatch.customer_id": "cust-x" },
        topicId: "topic-1",
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  await ch.exec({
    query: "ALTER TABLE trace_summaries DELETE WHERE TenantId IN ({a:String}, {b:String})",
    query_params: { a: tenantId, b: otherTenantId },
  });
});

const window = { projectId: tenantId, filters: {}, startDate: now - 60_000, endDate: now + 60_000 };

describe.skipIf(!clickHouseConfigured)("legacy built reads on live ClickHouse", () => {
  describe("when a thread's traces are read through the proof", () => {
    it("finds only the project's traces of that thread", async () => {
      const authorization = ownProof({ projectId: tenantId });

      const one = await repository.findTracesByThreadId({
        authorization,
        projectId: tenantId,
        threadId: "thread-1",
        retentionDays: undefined,
      });
      const many = await repository.findTracesWithSpansByThreadIds({
        authorization,
        projectId: tenantId,
        threadIds: ["thread-1", "thread-2"],
        retentionDays: undefined,
      });

      expect(one.map((trace) => trace.summary.traceId).toSorted()).toEqual(["trace-a", "trace-b"]);
      expect(many.map((trace) => trace.summary.traceId).toSorted()).toEqual([
        "trace-a",
        "trace-b",
        "trace-c",
      ]);
    });
  });

  describe("when the project's topics, customers and labels are read", () => {
    it("counts and lists only the project's own summaries in the window", async () => {
      const topics = await repository.findTopicCounts(window);
      const { customers, labels } = await repository.findCustomersAndLabels(window);

      expect(topics).toEqual(await repositoryOverMain());
      expect(customers).toEqual(["cust-1"]);
      expect(labels).toEqual(["red"]);
    });
  });
});

/** Main's topic count text, for parity: the same rows aggregated the same way. */
async function repositoryOverMain() {
  const result = await ch.query({
    query: `SELECT TopicId, SubTopicId, count() AS count FROM trace_summaries
      WHERE TenantId = {tenantId:String}
        AND CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})
        AND CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})
        AND (TopicId IS NOT NULL OR SubTopicId IS NOT NULL)
      GROUP BY TopicId, SubTopicId LIMIT 10000`,
    query_params: { tenantId, startDate: window.startDate, endDate: window.endDate },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ TopicId: string | null; count: string | number }>();
  expect(rows.map((row) => [row.TopicId, Number(row.count)])).toEqual([["topic-1", 2]]);
  return TraceLegacyReadClickHouseRepository.create({
    reader: clickHouseQueryClientDouble({ read: async () => ({ rows }) }),
  }).findTopicCounts(window);
}
