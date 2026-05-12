/**
 * Regression integration tests for issue #3088.
 *
 * Bug: `buildTimeseriesQuery` applied trace-level aggregations (sum of
 * TotalCost, etc.) directly over the evaluation_runs JOIN result, which fans
 * each trace out into N rows (one per evaluation run). The trace-level sums
 * ended up inflated by the eval row count.
 *
 * Fix: pre-aggregate evaluation metrics per trace inside a CTE, so the outer
 * query aggregates trace-level columns over each distinct trace exactly once.
 *
 * These tests seed real traces + evaluation_runs and execute the generated
 * SQL against ClickHouse to confirm trace metrics are no longer inflated when
 * mixed with evaluation metrics across all three affected query paths:
 *
 *   1. simple path (timeScale: number, no groupBy)
 *   2. arrayJoin path (groupBy that triggers arrayJoin)
 *   3. summary path (timeScale: "full", no groupBy)
 *
 * @see https://github.com/langwatch/langwatch/issues/3088
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  getTestClickHouseClient,
  cleanupTestData,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { buildTimeseriesQuery } from "../aggregation-builder";
import { resetParamCounter } from "../filter-translator";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import type { AggregationTypes } from "../../types";
import { seedSpans } from "./test-utils/clickhouse-fixtures";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";

const TENANT_ID = "test-trace-eval-mix-3088";

/** 2 traces × knownCost=10 => total_cost should be 20, not 60 */
const TRACE_COUNT = 2;
const KNOWN_COST = 10;
const EXPECTED_TOTAL_COST = TRACE_COUNT * KNOWN_COST;

/** 3 evaluation runs per trace, half passed */
const EVALS_PER_TRACE = 3;
const EVALUATOR_ID = "test-3088-evaluator";

const TRACE_ID_0 = `${TENANT_ID}-trace-0`;
const TRACE_ID_1 = `${TENANT_ID}-trace-1`;

const baseInput = {
  projectId: TENANT_ID,
  startDate: new Date("2020-01-01T00:00:00Z"),
  endDate: new Date("2030-01-01T00:00:00Z"),
  previousPeriodStartDate: new Date("2019-01-01T00:00:00Z"),
};

describe("trace-eval-mix-inflation (#3088)", () => {
  let ch: ClickHouseClient;

  beforeAll(
    async () => {
      const rawClient = getTestClickHouseClient();
      if (!rawClient) throw new Error("ClickHouse client not available");
      ch = wrapWithDefaultSettings(rawClient);

      // Seed 2 traces with knownCost=10 each. One span per trace is enough —
      // the bug is about evaluation_runs fan-out, not span fan-out.
      await seedSpans(ch, {
        tenantId: TENANT_ID,
        count: TRACE_COUNT,
        attributeKeys: 2,
        traceCount: TRACE_COUNT,
        knownCost: KNOWN_COST,
      });

      // Insert 3 evaluation_runs rows per trace (6 total). Half pass (Passed=1)
      // so the average pass rate across traces is a meaningful 0.5.
      const traceIds = [TRACE_ID_0, TRACE_ID_1];
      const evalRows: Array<Record<string, unknown>> = [];
      for (const traceId of traceIds) {
        for (let i = 0; i < EVALS_PER_TRACE; i++) {
          // Alternate passed values so ~half of evals per trace pass.
          const passed = i % 2 === 0 ? 1 : 0;
          evalRows.push({
            ProjectionId: `proj-3088-${traceId}-${i}`,
            TenantId: TENANT_ID,
            EvaluationId: `eval-3088-${traceId}-${i}`,
            Version: "1",
            EvaluatorId: EVALUATOR_ID,
            EvaluatorType: "custom",
            TraceId: traceId,
            Status: "processed",
            Score: passed === 1 ? 0.9 : 0.1,
            Passed: passed,
            Label: passed === 1 ? "good" : "bad",
            LastProcessedEventId: `evt-3088-${traceId}-${i}`,
            UpdatedAt: new Date().toISOString(),
          });
        }
      }

      await ch.insert({
        table: "evaluation_runs",
        values: evalRows,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    },
    60_000,
  );

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);

    // cleanupTestData does not delete from evaluation_runs — clean up manually
    const rawClient = getTestClickHouseClient();
    if (rawClient) {
      await rawClient.exec({
        query: `ALTER TABLE evaluation_runs DELETE WHERE TenantId = {tenantId:String} SETTINGS mutations_sync = 1`,
        query_params: { tenantId: TENANT_ID },
      });
    }
  });

  /** Pull a single metric value out of the first current-period row. */
  function extractMetric(
    rows: Array<Record<string, unknown>>,
    alias: string,
  ): number {
    const currentRows = rows.filter((r) => r["period"] === "current");
    expect(currentRows.length).toBeGreaterThan(0);
    // Sum across all current buckets (some paths return one row, others
    // return one row per date bucket).
    let total = 0;
    for (const row of currentRows) {
      const value = Number(row[alias]);
      if (Number.isFinite(value)) total += value;
    }
    return total;
  }

  function averageMetric(
    rows: Array<Record<string, unknown>>,
    alias: string,
  ): number {
    const currentRows = rows.filter((r) => r["period"] === "current");
    const values = currentRows
      .map((r) => Number(r[alias]))
      .filter((n) => Number.isFinite(n));
    if (values.length === 0) return NaN;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  async function runQuery(
    sql: string,
    params: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await ch.query({
      query: sql,
      query_params: params,
      format: "JSONEachRow",
    });
    return (await result.json()) as Array<Record<string, unknown>>;
  }

  describe("when mixing trace cost with eval pass rate on the simple path (timeScale: number)", () => {
    it("does not inflate total_cost by the number of evaluation runs per trace", async () => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        ...baseInput,
        timeScale: 60 * 24, // 1 day buckets — but single bucket will carry all
        series: [
          {
            metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
            aggregation: "sum" as AggregationTypes,
          },
          {
            metric:
              "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum,
            aggregation: "avg" as AggregationTypes,
            key: EVALUATOR_ID,
          },
        ],
      });

      const rows = await runQuery(sql, params);

      // Cost: 2 traces × 10 = 20. Pre-fix would have returned 60 (2 × 10 × 3 evals).
      const totalCost = extractMetric(
        rows,
        "0__performance_total_cost__sum",
      );
      expect(totalCost).toBeCloseTo(EXPECTED_TOTAL_COST);
      expect(totalCost).not.toBeCloseTo(EXPECTED_TOTAL_COST * EVALS_PER_TRACE);

      // Pass rate: eval sequence 1,0,1 per trace => per-trace pass rate 2/3 ≈ 0.667.
      // Cross-trace average ≈ 0.667.
      const passRate = averageMetric(
        rows,
        "1__evaluations_evaluation_pass_rate__avg__test_3088_evaluator",
      );
      expect(passRate).toBeGreaterThan(0);
      expect(passRate).toBeLessThanOrEqual(1);
    });
  });

  describe("when mixing trace cost with eval pass rate on the arrayJoin path (groupBy: metadata.model)", () => {
    it("does not inflate total_cost and still produces grouped results", async () => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        ...baseInput,
        timeScale: 60 * 24,
        groupBy: "metadata.model",
        series: [
          {
            metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
            aggregation: "sum" as AggregationTypes,
          },
          {
            metric:
              "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum,
            aggregation: "avg" as AggregationTypes,
            key: EVALUATOR_ID,
          },
        ],
      });

      const rows = await runQuery(sql, params);
      const currentRows = rows.filter((r) => r["period"] === "current");

      // seedSpans populates Models: ["gpt-5-mini"] for every trace, so we
      // expect the cost for that single group to equal EXPECTED_TOTAL_COST.
      const gpt5Rows = currentRows.filter(
        (r) => r["group_key"] === "gpt-5-mini",
      );
      expect(gpt5Rows.length).toBeGreaterThan(0);

      const totalCost = gpt5Rows
        .map((r) => Number(r["0__performance_total_cost__sum"]))
        .filter((n) => Number.isFinite(n))
        .reduce((a, b) => a + b, 0);

      expect(totalCost).toBeCloseTo(EXPECTED_TOTAL_COST);
      expect(totalCost).not.toBeCloseTo(EXPECTED_TOTAL_COST * EVALS_PER_TRACE);

      // Eval metric must still be present and sensible (0..1)
      const firstGpt5Row = gpt5Rows[0];
      expect(firstGpt5Row).toBeDefined();
      const passRate = Number(
        firstGpt5Row?.[
          "1__evaluations_evaluation_pass_rate__avg__test_3088_evaluator"
        ],
      );
      expect(passRate).toBeGreaterThan(0);
      expect(passRate).toBeLessThanOrEqual(1);
    });
  });

  describe("when mixing trace cost with eval pass rate on the summary path (timeScale: full)", () => {
    it("does not inflate total_cost for a single-bucket summary", async () => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        ...baseInput,
        timeScale: "full" as const,
        series: [
          {
            metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
            aggregation: "sum" as AggregationTypes,
          },
          {
            metric:
              "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum,
            aggregation: "avg" as AggregationTypes,
            key: EVALUATOR_ID,
          },
        ],
      });

      const rows = await runQuery(sql, params);

      const totalCost = extractMetric(
        rows,
        "0__performance_total_cost__sum",
      );
      expect(totalCost).toBeCloseTo(EXPECTED_TOTAL_COST);
      expect(totalCost).not.toBeCloseTo(EXPECTED_TOTAL_COST * EVALS_PER_TRACE);

      const passRate = averageMetric(
        rows,
        "1__evaluations_evaluation_pass_rate__avg__test_3088_evaluator",
      );
      expect(passRate).toBeGreaterThan(0);
      expect(passRate).toBeLessThanOrEqual(1);
    });
  });
});
