/**
 * The per-span analytics appends may share a statement with others waiting for a slot (ADR-187):
 * each reaches the routed member as an async insert that waits for the flush with async
 * deduplication off, which is what the member's coalescer asks of an insert.
 */
import {
  type ClickHouseQueryClient,
  coalesceKeyOf,
  type InsertRequest,
} from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { SpanAnalyticsRow } from "../../../eventing/span-analytics.projection.ts";
import type { TraceAnalyticsRollupRow } from "../../../eventing/trace-rollup.projection.ts";
import { MemberTraceClickHouseClientRepository } from "../clickhouse.trace-member-client.repository.ts";
import { SpanAnalyticsClickHouseRepository } from "../span-analytics.repository.ts";
import { TraceAnalyticsRollupClickHouseRepository } from "../trace-analytics-rollup.repository.ts";

function routedMember() {
  const inserts: InsertRequest[] = [];
  const clickhouse = createApiFixture<ClickHouseQueryClient>({
    insert: async (request) => {
      inserts.push(request);
    },
  });
  return { inserts, resolveClient: MemberTraceClickHouseClientRepository.resolverFor(clickhouse) };
}

function rollupRow(overrides: Partial<TraceAnalyticsRollupRow> = {}): TraceAnalyticsRollupRow {
  return {
    tenantId: "project-1",
    bucketStart: Temporal.Instant.fromEpochMilliseconds(1_700_000_040_000),
    model: "gpt-5",
    spanType: "llm",
    spanCount: 1,
    traceCount: 0,
    errorCount: 0,
    costSum: 0.01,
    nonBilledCostSum: 0,
    durationSum: 0,
    promptTokensSum: 10,
    completionTokensSum: 5,
    cacheReadTokensSum: 0,
    cacheWriteTokensSum: 0,
    reasoningTokensSum: 0,
    ...overrides,
  };
}

function spanAnalyticsRow(): SpanAnalyticsRow {
  return {
    tenantId: "project-1",
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: null,
    startTimeUnixMs: 1_700_000_000_000,
    endTimeUnixMs: 1_700_000_000_250,
    durationMs: 250,
    spanName: "llm call",
    spanKind: 3,
    statusCode: null,
    cost: null,
    nonBilledCost: null,
    spanType: "llm",
    errorType: "",
    ragContextCount: 0,
    inputHash: "0",
    deploymentEnvironment: "",
  };
}

describe("TraceAnalyticsRollupClickHouseRepository", () => {
  describe("when one span's increment is inserted", () => {
    it("sends an insert the member may coalesce, with async deduplication off", async () => {
      const { inserts, resolveClient } = routedMember();
      const repo = TraceAnalyticsRollupClickHouseRepository.create({ resolveClient });

      await repo.insertRow({ row: rollupRow(), retentionDays: 30 });

      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.settings?.async_insert_deduplicate).toBe(0);
      expect(inserts.map(coalesceKeyOf)).not.toContain(null);
    });
  });

  describe("when a batch of increments is inserted", () => {
    it("sends an insert the member may coalesce, with async deduplication off", async () => {
      const { inserts, resolveClient } = routedMember();
      const repo = TraceAnalyticsRollupClickHouseRepository.create({ resolveClient });

      await repo.insertRows({
        rows: [rollupRow(), rollupRow({ model: "gpt-5-mini" })],
        retentionDays: 30,
      });

      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.settings?.async_insert_deduplicate).toBe(0);
      expect(inserts.map(coalesceKeyOf)).not.toContain(null);
    });
  });
});

describe("SpanAnalyticsClickHouseRepository", () => {
  describe("when a span's analytics row is inserted", () => {
    it("sends an insert the member may coalesce, with async deduplication off", async () => {
      const { inserts, resolveClient } = routedMember();
      const repo = SpanAnalyticsClickHouseRepository.create({ resolveClient });

      await repo.insertRows({ rows: [spanAnalyticsRow()], retentionDays: 30 });

      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.settings?.async_insert_deduplicate).toBe(0);
      expect(inserts.map(coalesceKeyOf)).not.toContain(null);
    });
  });
});
