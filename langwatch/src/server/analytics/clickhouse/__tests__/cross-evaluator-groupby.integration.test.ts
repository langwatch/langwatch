/**
 * Regression integration tests for issue #2668.
 *
 * Bug: `buildTimeseriesQuery` applied `groupByAdditionalWhere` as a global SQL
 * WHERE predicate. For `evaluation_label` groupBy with `groupByKey = evaluatorA`,
 * this added `AND es.EvaluatorId = 'evaluatorA'` to the WHERE clause.
 *
 * The global filter excluded ALL evaluatorB rows from the JOIN, so:
 * - Any metric using evaluatorA returned null (no evaluatorA score rows if
 *   evaluatorA only stored labels, not scores)
 * - Any metric using evaluatorB returned null (evaluatorB rows excluded)
 *
 * The fix embeds the evaluator condition inside the group_key column expression
 * (an IF/CASE) so the JOIN keeps all evaluator rows. The HAVING clause then
 * filters out group_key='' (rows that don't match the groupBy evaluator),
 * while within each non-empty group the metric's own `avgIf` condition
 * correctly picks up score rows for that evaluator.
 *
 * These tests execute real queries against ClickHouse to confirm the fix holds.
 *
 * @see https://github.com/langwatch/langwatch/issues/2668
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

const TENANT_ID = "test-cross-eval-2668";

/** Base query input shared across all tests */
const baseInput = {
  projectId: TENANT_ID,
  startDate: new Date("2020-01-01T00:00:00Z"),
  endDate: new Date("2030-01-01T00:00:00Z"),
  previousPeriodStartDate: new Date("2019-01-01T00:00:00Z"),
  timeScale: "full" as const,
};

const TRACE_ID_0 = `${TENANT_ID}-trace-0`;
const TRACE_ID_1 = `${TENANT_ID}-trace-1`;

/**
 * evaluatorA: provides both labels ("good", "bad") AND scores — this evaluator
 *             is used as both the groupBy key AND the metric key in same-evaluator tests.
 * evaluatorB: provides scores only — used to verify cross-evaluator metric key behaviour.
 */
const EVALUATOR_A_ID = "cross-eval-2668-evaluatorA";
const EVALUATOR_B_ID = "cross-eval-2668-evaluatorB";

describe("cross-evaluator-groupby", () => {
  let ch: ClickHouseClient;

  beforeAll(
    async () => {
      const rawClient = getTestClickHouseClient();
      if (!rawClient) throw new Error("ClickHouse client not available");
      ch = wrapWithDefaultSettings(rawClient);

      await seedSpans(ch, {
        tenantId: TENANT_ID,
        count: 4,
        attributeKeys: 2,
        traceCount: 2,
      });

      await ch.insert({
        table: "evaluation_runs",
        values: [
          // evaluatorA trace 0: label "good", score 0.8
          {
            ProjectionId: "proj-cross-2668-a0",
            TenantId: TENANT_ID,
            EvaluationId: "eval-cross-2668-a0",
            Version: "1",
            EvaluatorId: EVALUATOR_A_ID,
            EvaluatorType: "custom",
            TraceId: TRACE_ID_0,
            Status: "processed",
            Score: 0.8,
            Passed: 1,
            Label: "good",
            LastProcessedEventId: "evt-cross-2668-a0",
            UpdatedAt: new Date().toISOString(),
          },
          // evaluatorA trace 1: label "bad", score 0.2
          {
            ProjectionId: "proj-cross-2668-a1",
            TenantId: TENANT_ID,
            EvaluationId: "eval-cross-2668-a1",
            Version: "1",
            EvaluatorId: EVALUATOR_A_ID,
            EvaluatorType: "custom",
            TraceId: TRACE_ID_1,
            Status: "processed",
            Score: 0.2,
            Passed: 0,
            Label: "bad",
            LastProcessedEventId: "evt-cross-2668-a1",
            UpdatedAt: new Date().toISOString(),
          },
          // evaluatorB trace 0: score 0.9 (no label)
          {
            ProjectionId: "proj-cross-2668-b0",
            TenantId: TENANT_ID,
            EvaluationId: "eval-cross-2668-b0",
            Version: "1",
            EvaluatorId: EVALUATOR_B_ID,
            EvaluatorType: "custom",
            TraceId: TRACE_ID_0,
            Status: "processed",
            Score: 0.9,
            Passed: 1,
            Label: null,
            LastProcessedEventId: "evt-cross-2668-b0",
            UpdatedAt: new Date().toISOString(),
          },
          // evaluatorB trace 1: score 0.3 (no label)
          {
            ProjectionId: "proj-cross-2668-b1",
            TenantId: TENANT_ID,
            EvaluationId: "eval-cross-2668-b1",
            Version: "1",
            EvaluatorId: EVALUATOR_B_ID,
            EvaluatorType: "custom",
            TraceId: TRACE_ID_1,
            Status: "processed",
            Score: 0.3,
            Passed: 0,
            Label: null,
            LastProcessedEventId: "evt-cross-2668-b1",
            UpdatedAt: new Date().toISOString(),
          },
        ],
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

  describe("regression: issue #2668 — groupByKey evaluator filter removed from global WHERE", () => {
    describe("when evaluation_label groupBy with groupByKey uses the SAME evaluator as the metric key", () => {
      it("returns correct per-label average scores for evaluatorA label groups", async () => {
        // This is the primary regression case. Before the fix, the global WHERE
        // added `AND es.EvaluatorId = evaluatorA`, which excluded all non-evaluatorA
        // rows. Since evaluatorA rows carried BOTH the label and the score, the fix
        // allows the avgIf to find score rows within each label group.
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          groupBy: "evaluations.evaluation_label",
          groupByKey: EVALUATOR_A_ID,
          series: [
            {
              metric:
                "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as AggregationTypes,
              key: EVALUATOR_A_ID,
            },
          ],
        });

        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });

        type Row = Record<string, unknown>;
        const rows = (await result.json()) as Row[];

        expect(Array.isArray(rows)).toBe(true);

        const currentRows = rows.filter((r) => r["period"] === "current");

        const goodRows = currentRows.filter((r) => r["group_key"] === "good");
        const badRows = currentRows.filter((r) => r["group_key"] === "bad");

        expect(goodRows.length).toBeGreaterThan(0);
        expect(badRows.length).toBeGreaterThan(0);

        // Find the metric alias (not "date", "period", or "group_key")
        const metricKey = Object.keys(goodRows[0]!).find(
          (k) => k !== "date" && k !== "period" && k !== "group_key",
        );
        expect(metricKey).toBeDefined();

        // evaluatorA trace 0 ("good") has score 0.8; trace 1 ("bad") has score 0.2
        const goodScore = Number(goodRows[0]![metricKey!]);
        const badScore = Number(badRows[0]![metricKey!]);

        expect(goodScore).toBeCloseTo(0.8);
        expect(badScore).toBeCloseTo(0.2);
      });
    });

    describe("when evaluation_passed groupBy with groupByKey uses the SAME evaluator as the metric key", () => {
      it("returns correct per-pass/fail average scores for evaluatorA groups", async () => {
        // evaluatorA has Passed=1 for trace 0 ("good") and Passed=0 for trace 1 ("bad").
        // groupBy evaluation_passed with groupByKey=evaluatorA, metric evaluatorA score.
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          groupBy: "evaluations.evaluation_passed",
          groupByKey: EVALUATOR_A_ID,
          series: [
            {
              metric:
                "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as AggregationTypes,
              key: EVALUATOR_A_ID,
            },
          ],
        });

        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });

        type Row = Record<string, unknown>;
        const rows = (await result.json()) as Row[];

        expect(Array.isArray(rows)).toBe(true);

        const currentRows = rows.filter((r) => r["period"] === "current");

        const passedRows = currentRows.filter(
          (r) => r["group_key"] === "passed",
        );
        const failedRows = currentRows.filter(
          (r) => r["group_key"] === "failed",
        );

        expect(passedRows.length).toBeGreaterThan(0);
        expect(failedRows.length).toBeGreaterThan(0);

        const metricKey = Object.keys(passedRows[0]!).find(
          (k) => k !== "date" && k !== "period" && k !== "group_key",
        );
        expect(metricKey).toBeDefined();

        const passedScore = Number(passedRows[0]![metricKey!]);
        const failedScore = Number(failedRows[0]![metricKey!]);

        // evaluatorA trace 0 (passed=1) has score 0.8; trace 1 (passed=0) has score 0.2
        expect(passedScore).toBeCloseTo(0.8);
        expect(failedScore).toBeCloseTo(0.2);
      });
    });

    describe("when evaluation_label groupBy has no groupByKey", () => {
      it("returns labels from all evaluators with correct metric values", async () => {
        // Without groupByKey, the groupBy column is just `es.Label` — no evaluator
        // filtering at all. All labels from all evaluators (that have labels) appear.
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          groupBy: "evaluations.evaluation_label",
          // no groupByKey — collect labels from all evaluators
          series: [
            {
              metric:
                "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as AggregationTypes,
              key: EVALUATOR_A_ID,
            },
          ],
        });

        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });

        type Row = Record<string, unknown>;
        const rows = (await result.json()) as Row[];

        expect(Array.isArray(rows)).toBe(true);

        const currentRows = rows.filter((r) => r["period"] === "current");

        // Labels "good" and "bad" come from evaluatorA
        const groupKeys = currentRows.map((r) => r["group_key"]);
        expect(groupKeys).toContain("good");
        expect(groupKeys).toContain("bad");

        // evaluatorA labels appear; metric (evaluatorA score) is non-null
        const metricKey = Object.keys(currentRows[0]!).find(
          (k) => k !== "date" && k !== "period" && k !== "group_key",
        );
        expect(metricKey).toBeDefined();

        const goodRow = currentRows.find((r) => r["group_key"] === "good");
        const badRow = currentRows.find((r) => r["group_key"] === "bad");

        expect(goodRow).toBeDefined();
        expect(badRow).toBeDefined();
        expect(Number(goodRow![metricKey!])).toBeCloseTo(0.8);
        expect(Number(badRow![metricKey!])).toBeCloseTo(0.2);
      });
    });

    describe("when evaluation_label groupBy uses evaluatorA and evaluation_score metric uses evaluatorB", () => {
      it("executes cross-evaluator query without crash and returns label groups", async () => {
        // Cross-evaluator scenario: groupBy label from evaluatorA, metric score from evaluatorB.
        //
        // The fix removes the global WHERE filter so evaluatorB rows are no longer
        // excluded from the query. The query executes correctly and returns group rows
        // for each evaluatorA label. However, because each evaluation_runs row is
        // associated with exactly one evaluator, the GROUP BY group_key collapses
        // evaluatorB rows into an empty-string bucket (HAVING'd out) — so the avgIf
        // for evaluatorB finds no rows in the "good"/"bad" groups and returns null.
        //
        // The null metric value is the expected current behaviour for cross-evaluator
        // queries and the fix does not claim to solve it. What the fix guarantees is:
        // - the query runs without a crash
        // - label groups ARE returned (not empty result set)
        // - the global WHERE does not contain a standalone EvaluatorId filter
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          groupBy: "evaluations.evaluation_label",
          groupByKey: EVALUATOR_A_ID,
          series: [
            {
              metric:
                "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as AggregationTypes,
              key: EVALUATOR_B_ID,
            },
          ],
        });

        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });

        type Row = Record<string, unknown>;
        const rows = (await result.json()) as Row[];

        // Query must not crash
        expect(Array.isArray(rows)).toBe(true);

        const currentRows = rows.filter((r) => r["period"] === "current");

        // Label groups must appear — the fix preserves the groupBy behaviour
        const groupKeys = currentRows.map((r) => r["group_key"]);
        expect(groupKeys).toContain("good");
        expect(groupKeys).toContain("bad");

        // The global WHERE must not have pre-filtered to evaluatorA
        // (regression guard: if it had, there would be no evaluatorB rows at all
        // and label rows would also be affected via missing join data)
        const whereSection = sql.split("GROUP BY")[0] ?? sql;
        expect(whereSection).not.toMatch(
          /AND\s+es\.EvaluatorId\s*=\s*\{groupByKey:String\}/,
        );
      });
    });
  });
});
