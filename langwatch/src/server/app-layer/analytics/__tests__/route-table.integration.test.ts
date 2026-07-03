/**
 * Integration tests for the Phase 3 read routing (ADR-034).
 *
 * Drives the new slim + rollup SQL builders against a real ClickHouse
 * testcontainer (migrations 00035 + 00037 auto-apply via goose in
 * `startTestContainers`). Seeds rows directly through the same Phase 1 + Phase 2
 * write-side repositories the projections use, and additionally drives the
 * legacy `trace_summaries` builder for the "no-routing / fallback" case.
 *
 * Asserts:
 *
 *   (a) rollup query and slim query return matching numbers for the same
 *       additive metric over the same time window — the parity assertion
 *       the project review will look at first;
 *   (b) the slim group-by-topic chart works end-to-end;
 *   (c) the legacy trace_summaries builder still works (no rows written →
 *       returns zero) — proves the fallback path is preserved.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TraceAnalyticsClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-analytics.clickhouse.repository";
import { TraceAnalyticsRollupClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-analytics-rollup.clickhouse.repository";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsRow,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import type { TraceAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalyticsRollup.mapProjection";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { buildTimeseriesQuery } from "~/server/analytics/clickhouse/aggregation-builder";
import { buildRollupTimeseriesQuery } from "../query-builders/rollup-timeseries-query";
import { buildSlimTimeseriesQuery } from "../query-builders/slim-timeseries-query";
import type { AnalyticsTimeseriesBuilderInput } from "../types";

const tenantId = `test-router-${nanoid()}`;

// All seeded rows land in one minute bucket so the rollup collapses cleanly.
const bucketMs = new Date("2026-06-15T12:00:00.000Z").getTime();
const bucketStart = new Date(bucketMs);

let ch: ClickHouseClient;
let analyticsRepo: TraceAnalyticsClickHouseRepository;
let rollupRepo: TraceAnalyticsRollupClickHouseRepository;

function makeRollupRow(
  overrides: Partial<TraceAnalyticsRollupRow> = {},
): TraceAnalyticsRollupRow {
  return {
    tenantId,
    bucketStart,
    model: "",
    spanType: "",
    spanCount: 1,
    errorCount: 0,
    costSum: 0,
    nonBilledCostSum: 0,
    durationSum: 0,
    promptTokensSum: 0,
    completionTokensSum: 0,
    cacheReadTokensSum: 0,
    cacheWriteTokensSum: 0,
    reasoningTokensSum: 0,
    ...overrides,
  };
}

function makeSlimRow(
  overrides: Partial<TraceAnalyticsRow> = {},
): TraceAnalyticsRow {
  return {
    tenantId,
    traceId: `slim-trace-${nanoid()}`,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
    occurredAtMs: bucketMs,
    createdAtMs: bucketMs,
    updatedAtMs: bucketMs,
    traceName: "test trace",
    topicId: null,
    subTopicId: null,
    userId: null,
    conversationId: null,
    customerId: null,
    origin: "",
    models: [],
    labels: [],
    totalCost: 0,
    nonBilledCost: 0,
    totalDurationMs: 0,
    timeToFirstTokenMs: null,
    tokensPerSecond: null,
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    hasError: false,
    hasAnnotation: null,
    attributes: {},
    ...overrides,
  };
}

async function flushAsyncInserts(): Promise<void> {
  await ch.exec({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
  await ch.exec({ query: "SYSTEM FLUSH LOGS" });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  analyticsRepo = new TraceAnalyticsClickHouseRepository(async () => ch);
  rollupRepo = new TraceAnalyticsRollupClickHouseRepository(async () => ch);

  // Seed THREE per-span rollup rows in the same bucket: total cost = 0.10,
  // matched by ONE slim row representing the trace those spans belong to.
  await rollupRepo.insertRows([
    makeRollupRow({ costSum: 0.01, durationSum: 0 }),
    makeRollupRow({ costSum: 0.04, durationSum: 0 }),
    makeRollupRow({ costSum: 0.05, durationSum: 100 }),
  ]);

  await analyticsRepo.upsertBatch([
    {
      row: makeSlimRow({
        topicId: "topic-cooking",
        totalCost: 0.1,
        totalDurationMs: 100,
        userId: "alice",
      }),
    },
  ]);

  await flushAsyncInserts();
}, 180_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE trace_analytics_rollup DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
    await ch.exec({
      query:
        "ALTER TABLE trace_analytics DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

const dayWindow = {
  startDate: new Date(bucketMs - 60 * 60 * 1000), // 1h before bucket
  endDate: new Date(bucketMs + 60 * 60 * 1000), // 1h after bucket
  previousPeriodStartDate: new Date(bucketMs - 26 * 60 * 60 * 1000), // 25h before window
  timeScale: 1440 as const, // daily — collapses the bucket into one row
  timeZone: "UTC",
};

/**
 * Execute a built query against the testcontainer and return the rows.
 * Mirrors the executor in ClickHouseAnalyticsService.getTimeseries so the
 * integration test exercises the same SQL → result pipeline without needing
 * to plumb through the prisma-backed project resolver.
 */
async function runQuery(sql: string, params: Record<string, unknown>) {
  const result = await ch.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
  });
  return (await result.json()) as Array<Record<string, unknown>>;
}

describe("Phase 3 read routing — SQL builder against real CH", () => {
  describe("given a sum(total_cost) query over the seeded bucket", () => {
    const baseInput: AnalyticsTimeseriesBuilderInput = {
      projectId: tenantId,
      startDate: dayWindow.startDate,
      endDate: dayWindow.endDate,
      previousPeriodStartDate: dayWindow.previousPeriodStartDate,
      series: [
        { metric: "performance.total_cost", aggregation: "sum" as const },
      ],
      timeScale: dayWindow.timeScale,
      timeZone: dayWindow.timeZone,
    };

    it("returns 0.10 from the rollup builder", async () => {
      const { sql, params } = buildRollupTimeseriesQuery(baseInput);
      const rows = await runQuery(sql, params);
      const currentRows = rows.filter((r) => r.period === "current");
      const sum = sumValue(currentRows, "0__performance_total_cost__sum");
      expect(sum).toBeCloseTo(0.1, 6);
    });

    it("returns 0.10 from the slim builder", async () => {
      const { sql, params } = buildSlimTimeseriesQuery(baseInput);
      const rows = await runQuery(sql, params);
      const currentRows = rows.filter((r) => r.period === "current");
      const sum = sumValue(currentRows, "0__performance_total_cost__sum");
      expect(sum).toBeCloseTo(0.1, 6);
    });

    it("returns matching numbers from rollup and slim (parity assertion)", async () => {
      const rollupBuild = buildRollupTimeseriesQuery(baseInput);
      const slimBuild = buildSlimTimeseriesQuery(baseInput);

      const [rollupRows, slimRows] = await Promise.all([
        runQuery(rollupBuild.sql, rollupBuild.params),
        runQuery(slimBuild.sql, slimBuild.params),
      ]);

      const rollupSum = sumValue(
        rollupRows.filter((r) => r.period === "current"),
        "0__performance_total_cost__sum",
      );
      const slimSum = sumValue(
        slimRows.filter((r) => r.period === "current"),
        "0__performance_total_cost__sum",
      );
      expect(slimSum).toBeCloseTo(rollupSum, 6);
    });
  });

  describe("given a topic-grouped chart on slim", () => {
    it("returns a row with group_key='topic-cooking' and the slim sum", async () => {
      const { sql, params } = buildSlimTimeseriesQuery({
        projectId: tenantId,
        startDate: dayWindow.startDate,
        endDate: dayWindow.endDate,
        previousPeriodStartDate: dayWindow.previousPeriodStartDate,
        series: [
          { metric: "performance.total_cost", aggregation: "sum" as const },
        ],
        groupBy: "topics.topics",
        timeScale: dayWindow.timeScale,
        timeZone: dayWindow.timeZone,
      });
      const rows = await runQuery(sql, params);
      const cookingRow = rows.find(
        (r) => r.period === "current" && r.group_key === "topic-cooking",
      );
      expect(cookingRow).toBeDefined();
      const v = cookingRow?.["0__performance_total_cost__sum"];
      expect(typeof v === "string" || typeof v === "number").toBe(true);
      expect(Number(v)).toBeCloseTo(0.1, 6);
    });
  });

  describe("legacy trace_summaries fallback", () => {
    it("hits trace_summaries — returns 0 because we never wrote to trace_summaries", async () => {
      const { sql, params } = buildTimeseriesQuery({
        projectId: tenantId,
        startDate: dayWindow.startDate,
        endDate: dayWindow.endDate,
        previousPeriodStartDate: dayWindow.previousPeriodStartDate,
        series: [
          { metric: "performance.total_cost", aggregation: "sum" as const },
        ],
        timeScale: dayWindow.timeScale,
        timeZone: dayWindow.timeZone,
      });
      // The SQL must reference trace_summaries (not slim/rollup) — proves
      // the legacy code path stays the safe fallback.
      expect(sql).toContain("FROM trace_summaries");
      expect(sql).not.toContain("FROM trace_analytics_rollup");
      const rows = await runQuery(sql, params);
      const currentRows = rows.filter((r) => r.period === "current");
      const sum = sumValue(currentRows, "0__performance_total_cost__sum");
      expect(sum).toBe(0);
    });
  });
});

function sumValue(
  rows: Array<Record<string, unknown>>,
  key: string,
): number {
  let total = 0;
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number") total += v;
    else if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) total += n;
    }
  }
  return total;
}
