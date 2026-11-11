/** The rollup's writes reach the query client as inserts that may share a statement (ADR-187). */
import { coalesceKeyOf, type InsertRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { TraceAnalyticsRollupRow } from "../../../eventing/trace-rollup.projection.ts";
import { MemberTraceClickHouseClientRepository } from "../clickhouse.trace-member-client.repository.ts";
import { TraceAnalyticsRollupClickHouseRepository } from "../trace-analytics-rollup.repository.ts";

function repositoryOverQueryClient() {
  const sent: InsertRequest[] = [];
  const repo = TraceAnalyticsRollupClickHouseRepository.create({
    resolveClient: MemberTraceClickHouseClientRepository.resolverFor(
      clickHouseQueryClientDouble({
        insert: async (request: InsertRequest) => {
          sent.push(request);
        },
      }),
    ),
  });
  return { repo, sent };
}

function rollupRow(overrides: Partial<TraceAnalyticsRollupRow> = {}): TraceAnalyticsRollupRow {
  return {
    tenantId: "project-1",
    bucketStart: Temporal.Instant.fromEpochMilliseconds(1_700_000_040_000),
    model: "gpt-5",
    spanType: "llm",
    spanCount: 1,
    traceCount: 1,
    errorCount: 0,
    costSum: 0.01,
    nonBilledCostSum: 0,
    durationSum: 250,
    promptTokensSum: 10,
    completionTokensSum: 20,
    cacheReadTokensSum: 0,
    cacheWriteTokensSum: 0,
    reasoningTokensSum: 0,
    ...overrides,
  };
}

describe("TraceAnalyticsRollupClickHouseRepository", () => {
  describe("when rollup rows are written while every insert slot is taken", () => {
    it("sends a single row as an insert that may share a statement", async () => {
      const { repo, sent } = repositoryOverQueryClient();

      await repo.insertRow({ row: rollupRow(), retentionDays: 30 });

      expect(sent).toHaveLength(1);
      expect(sent[0]?.table).toBe("trace_analytics_rollup");
      expect(coalesceKeyOf(sent[0]!)).not.toBeNull();
    });

    it("sends a batch of rows as an insert that may share a statement", async () => {
      const { repo, sent } = repositoryOverQueryClient();

      await repo.insertRows({
        rows: [rollupRow(), rollupRow({ model: "gpt-5-mini" })],
        retentionDays: 30,
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]?.rows).toHaveLength(2);
      expect(coalesceKeyOf(sent[0]!)).not.toBeNull();
    });
  });
});
