/**
 * ADR-034 Phase 6 integration tests for eval analytics — drives the
 * write-side eval repositories against a real ClickHouse testcontainer
 * (migrations 00038 + 00039 auto-apply via goose in `startTestContainers`)
 * and validates:
 *
 *   - JSONEachRow + UInt64/Int64 stringification + async_insert flow
 *     (write path) for both rollup + slim;
 *   - latest-version dedup on the slim table via repeated upserts;
 *   - additive collapse on the rollup via repeated inserts (sum semantics).
 *
 * Mirrors the trace-side `route-table.integration.test.ts` style.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvaluationAnalyticsClickHouseRepository } from "~/server/app-layer/evaluations/repositories/evaluation-analytics.clickhouse.repository";
import { EvaluationAnalyticsRollupClickHouseRepository } from "~/server/app-layer/evaluations/repositories/evaluation-analytics-rollup.clickhouse.repository";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type EvaluationAnalyticsRow,
} from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import type { EvaluationAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalyticsRollup.mapProjection";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

const tenantId = `test-eval-${nanoid()}`;

const bucketMs = new Date("2026-06-15T12:00:00.000Z").getTime();
const bucketStart = new Date(bucketMs);

let ch: ClickHouseClient;
let slimRepo: EvaluationAnalyticsClickHouseRepository;
let rollupRepo: EvaluationAnalyticsRollupClickHouseRepository;

function makeRollupRow(
  overrides: Partial<EvaluationAnalyticsRollupRow> = {},
): EvaluationAnalyticsRollupRow {
  return {
    tenantId,
    bucketStart,
    evaluatorType: "langevals/test",
    status: "processed",
    evalCount: 1,
    passCount: 1,
    failCount: 0,
    errorCount: 0,
    skippedCount: 0,
    scoreSum: 0.8,
    scoreCount: 1,
    durationSum: 0,
    costSum: 0,
    nonBilledCostSum: 0,
    ...overrides,
  };
}

function makeSlimRow(
  overrides: Partial<EvaluationAnalyticsRow> = {},
): EvaluationAnalyticsRow {
  return {
    tenantId,
    evaluationId: `eval-${nanoid()}`,
    version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
    occurredAtMs: bucketMs,
    createdAtMs: bucketMs,
    updatedAtMs: bucketMs,
    evaluatorType: "langevals/test",
    evaluatorName: "Judge",
    status: "processed",
    isGuardrail: false,
    passed: true,
    score: 0.8,
    label: null,
    model: null,
    traceId: `trace-${nanoid()}`,
    userId: null,
    conversationId: null,
    customerId: null,
    origin: null,
    durationMs: 0,
    totalCost: null,
    nonBilledCost: null,
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
  slimRepo = new EvaluationAnalyticsClickHouseRepository(async () => ch);
  rollupRepo = new EvaluationAnalyticsRollupClickHouseRepository(
    async () => ch,
  );
}, 180_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE evaluation_analytics_rollup DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
    await ch.exec({
      query:
        "ALTER TABLE evaluation_analytics DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("evaluation_analytics_rollup — write path (ADR-034 Phase 6)", () => {
  it("inserts per-evaluation rows and SimpleAggregateFunction(sum) collapses cleanly on merge", async () => {
    // Seed three evals in the same bucket — 2 pass, 1 fail.
    await rollupRepo.insertRows([
      makeRollupRow({ passCount: 1, failCount: 0, scoreSum: 1.0, scoreCount: 1 }),
      makeRollupRow({ passCount: 1, failCount: 0, scoreSum: 0.7, scoreCount: 1 }),
      makeRollupRow({ passCount: 0, failCount: 1, scoreSum: 0.0, scoreCount: 1 }),
    ]);
    await flushAsyncInserts();
    await ch.exec({ query: "OPTIMIZE TABLE evaluation_analytics_rollup FINAL" });

    const result = await ch.query({
      query: `
        SELECT
          sum(EvalCount) AS total,
          sum(PassCount) AS passed,
          sum(FailCount) AS failed,
          sum(ScoreSum) AS scoreSum,
          sum(ScoreCount) AS scoreCount,
          sum(ScoreSum) / nullIf(sum(ScoreCount), 0) AS avgScore
        FROM evaluation_analytics_rollup
        WHERE TenantId = {tenantId:String}
          AND BucketStart = parseDateTime64BestEffort({bucketStart:String}, 3)
      `,
      query_params: {
        tenantId,
        // CH's `DateTime64(3)` parameter parser rejects the trailing `Z`
        // in JS ISO strings; we pass the canonical "%Y-%m-%d %H:%M:%S.%f"
        // shape instead via a String parameter + parseDateTime64.
        bucketStart: bucketStart
          .toISOString()
          .replace("T", " ")
          .replace("Z", ""),
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      total: string;
      passed: string;
      failed: string;
      scoreSum: number;
      scoreCount: string;
      avgScore: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.total)).toBe(3);
    expect(Number(rows[0]!.passed)).toBe(2);
    expect(Number(rows[0]!.failed)).toBe(1);
    expect(rows[0]!.scoreSum).toBeCloseTo(1.7, 5);
    expect(Number(rows[0]!.scoreCount)).toBe(3);
    expect(rows[0]!.avgScore).toBeCloseTo(1.7 / 3, 5);
  });
});

describe("evaluation_analytics — write path (ADR-034 Phase 6)", () => {
  it("upserts a slim row and a later-version upsert wins via ReplacingMergeTree(UpdatedAt)", async () => {
    const evalId = `eval-version-test-${nanoid()}`;

    await slimRepo.upsert(
      makeSlimRow({
        evaluationId: evalId,
        score: 0.5,
        passed: false,
        updatedAtMs: bucketMs,
      }),
    );
    await slimRepo.upsert(
      makeSlimRow({
        evaluationId: evalId,
        score: 0.9,
        passed: true,
        updatedAtMs: bucketMs + 1_000,
      }),
    );
    await flushAsyncInserts();
    await ch.exec({ query: "OPTIMIZE TABLE evaluation_analytics FINAL" });

    const result = await ch.query({
      query: `
        SELECT Score AS score, Passed AS passed
        FROM evaluation_analytics
        WHERE TenantId = {tenantId:String}
          AND EvaluationId = {evalId:String}
          AND (TenantId, EvaluationId, UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM evaluation_analytics
            WHERE TenantId = {tenantId:String}
              AND EvaluationId = {evalId:String}
            GROUP BY TenantId, EvaluationId
          )
      `,
      query_params: { tenantId, evalId },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      score: number;
      passed: boolean;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBeCloseTo(0.9, 5);
    expect(rows[0]!.passed).toBe(true);
  });
});
