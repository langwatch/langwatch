/**
 * Regression integration test for issue #3900.
 *
 * Bug: Offline-experiment evaluation results produced by the orchestrator are
 * written to `evaluation_runs` (via reportEvaluation → EvaluationRunFoldProjection
 * → upsert) but the corresponding `trace_summaries` row is never written for
 * offline-cell trace IDs. Because the analytics read path JOINs (INNER) from
 * `trace_summaries` to `evaluation_runs` on (TenantId, TraceId), any evaluation
 * row whose TraceId has no matching trace_summary is silently dropped. The
 * Custom Graphs chart therefore shows an empty plot for offline experiments.
 *
 * Test strategy:
 * - Seed `evaluation_runs` rows for synthetic offline-cell trace IDs.
 * - Deliberately do NOT seed `trace_summaries` for those trace IDs — this
 *   faithfully simulates what the production offline-experiment pipeline does
 *   today (the bug state).
 * - Execute the real `buildTimeseriesQuery` for `evaluations.evaluation_score`
 *   and `evaluations.evaluation_pass_rate` against the test ClickHouse.
 * - Assert that the result contains at least one non-null / non-zero metric
 *   bucket — this assertion will FAIL on current main because the JOIN drops
 *   all offline-experiment rows. After the fix (Phase 1 / Phase 2), it will
 *   pass.
 *
 * @see https://github.com/langwatch/langwatch/issues/3900
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
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";

const TENANT_ID = "test-offline-exp-3900";

/**
 * Synthetic trace IDs that the offline-experiment orchestrator would generate
 * per cell — these exist ONLY in evaluation_runs, never in trace_summaries.
 * That omission is the production bug we are simulating.
 */
const OFFLINE_TRACE_ID_0 = `${TENANT_ID}-offline-cell-trace-0`;
const OFFLINE_TRACE_ID_1 = `${TENANT_ID}-offline-cell-trace-1`;

/**
 * evaluatorA: numeric evaluator (produces Score values, no Passed)
 * evaluatorB: boolean evaluator (produces Passed values, no Score)
 */
const NUMERIC_EVALUATOR_ID = "offline-3900-numeric-evaluator";
const BOOL_EVALUATOR_ID = "offline-3900-bool-evaluator";

/** Wide date range so rows are always inside the query window */
const baseInput = {
  projectId: TENANT_ID,
  startDate: new Date("2020-01-01T00:00:00Z"),
  endDate: new Date("2030-01-01T00:00:00Z"),
  previousPeriodStartDate: new Date("2019-01-01T00:00:00Z"),
  timeScale: "full" as const,
};

describe("offline-experiment evaluations on Custom Graphs", () => {
  let ch: ClickHouseClient;

  beforeAll(
    async () => {
      const rawClient = getTestClickHouseClient();
      if (!rawClient) throw new Error("ClickHouse client not available");
      ch = wrapWithDefaultSettings(rawClient);

      /**
       * Simulate the offline-experiment runtime state:
       *
       * The orchestrator generates a synthetic traceId per cell and calls
       * reportEvaluation, which writes to evaluation_runs.  The trace_summaries
       * row is NEVER written — that is the production bug.  We faithfully
       * reproduce this by inserting into evaluation_runs only.
       */
      await ch.insert({
        table: "evaluation_runs",
        values: [
          // Numeric evaluator, cell 0: score 0.75
          {
            ProjectionId: "proj-offline-3900-num-0",
            TenantId: TENANT_ID,
            EvaluationId: "eval-offline-3900-num-0",
            Version: "1",
            EvaluatorId: NUMERIC_EVALUATOR_ID,
            EvaluatorType: "custom",
            TraceId: OFFLINE_TRACE_ID_0,
            Status: "processed",
            Score: 0.75,
            Passed: null,
            Label: null,
            LastProcessedEventId: "evt-offline-3900-num-0",
            UpdatedAt: new Date("2025-06-01T10:00:00Z").toISOString(),
          },
          // Numeric evaluator, cell 1: score 0.25
          {
            ProjectionId: "proj-offline-3900-num-1",
            TenantId: TENANT_ID,
            EvaluationId: "eval-offline-3900-num-1",
            Version: "1",
            EvaluatorId: NUMERIC_EVALUATOR_ID,
            EvaluatorType: "custom",
            TraceId: OFFLINE_TRACE_ID_1,
            Status: "processed",
            Score: 0.25,
            Passed: null,
            Label: null,
            LastProcessedEventId: "evt-offline-3900-num-1",
            UpdatedAt: new Date("2025-06-01T10:00:01Z").toISOString(),
          },
          // Boolean evaluator, cell 0: passed
          {
            ProjectionId: "proj-offline-3900-bool-0",
            TenantId: TENANT_ID,
            EvaluationId: "eval-offline-3900-bool-0",
            Version: "1",
            EvaluatorId: BOOL_EVALUATOR_ID,
            EvaluatorType: "custom",
            TraceId: OFFLINE_TRACE_ID_0,
            Status: "processed",
            Score: null,
            Passed: 1,
            Label: null,
            LastProcessedEventId: "evt-offline-3900-bool-0",
            UpdatedAt: new Date("2025-06-01T10:00:02Z").toISOString(),
          },
          // Boolean evaluator, cell 1: failed
          {
            ProjectionId: "proj-offline-3900-bool-1",
            TenantId: TENANT_ID,
            EvaluationId: "eval-offline-3900-bool-1",
            Version: "1",
            EvaluatorId: BOOL_EVALUATOR_ID,
            EvaluatorType: "custom",
            TraceId: OFFLINE_TRACE_ID_1,
            Status: "processed",
            Score: null,
            Passed: 0,
            Label: null,
            LastProcessedEventId: "evt-offline-3900-bool-1",
            UpdatedAt: new Date("2025-06-01T10:00:03Z").toISOString(),
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });

      // Intentionally do NOT insert into trace_summaries.
      // OFFLINE_TRACE_ID_0 and OFFLINE_TRACE_ID_1 have no trace_summary rows.
      // This is exactly the production bug: the offline-experiment pipeline
      // writes evaluation_runs but never writes trace_summaries for offline cells.
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

  describe("given an offline experiment writes evaluation rows but no matching trace_summary", () => {
    describe("when the analytics layer queries evaluation_score for the experiment's evaluator", () => {
      /**
       * @scenario Offline experiment writes joinable evaluation_runs rows for boolean and numeric evaluators
       */
      it("returns non-empty evaluation_score buckets for the offline-experiment evaluator", async () => {
        // This assertion FAILS on current main.
        //
        // The analytics read path JOINs evaluation_runs to trace_summaries on
        // (TenantId, TraceId).  Because no trace_summary rows exist for the
        // offline-cell trace IDs, the JOIN drops all evaluation_runs rows.
        // The result is empty (all metric values are null/0), proving the bug.
        //
        // After the fix (either: the write path seeds trace_summaries for
        // offline cells, OR the JOIN is relaxed to a LEFT JOIN from
        // evaluation_runs), this assertion must pass.
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric:
                "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg",
              key: NUMERIC_EVALUATOR_ID,
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

        // Find the metric column (not "date", "period", or "group_key")
        const currentRows = rows.filter((r) => r["period"] === "current");

        // At least one bucket must exist with a non-null numeric score.
        // On current main this fails: currentRows is empty (or all metric
        // values are null) because the INNER JOIN drops the offline rows.
        const metricKey = Object.keys(currentRows[0] ?? {}).find(
          (k) => k !== "date" && k !== "period" && k !== "group_key",
        );

        // The metric key must be found — if the query returned nothing there
        // are no rows at all, making this the definitive failure signal.
        expect(
          metricKey,
          "No metric column found — query returned zero rows (offline evaluation_runs rows were dropped by the JOIN to trace_summaries)",
        ).toBeDefined();

        // The score value must be non-null and non-zero (we seeded 0.75 and 0.25).
        const score = Number(currentRows[0]?.[metricKey!]);
        expect(
          isNaN(score) || score === 0,
          `Metric value was ${score} — offline evaluation rows were dropped by the JOIN (bug #3900)`,
        ).toBe(false);
      });

      it("returns non-empty evaluation_pass_rate buckets for the offline-experiment evaluator", async () => {
        // Same as above but for the boolean evaluator and evaluation_pass_rate.
        // Passed=1 (cell 0) and Passed=0 (cell 1) → avg pass_rate = 0.5.
        // Fails on current main for the same JOIN reason.
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric:
                "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg",
              key: BOOL_EVALUATOR_ID,
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

        const metricKey = Object.keys(currentRows[0] ?? {}).find(
          (k) => k !== "date" && k !== "period" && k !== "group_key",
        );

        expect(
          metricKey,
          "No metric column found — query returned zero rows (offline evaluation_runs rows were dropped by the JOIN to trace_summaries)",
        ).toBeDefined();

        // avg(Passed) = (1 + 0) / 2 = 0.5 if rows are visible.
        // If rows are dropped by the JOIN, avg() of nothing returns 0 (not NaN)
        // because the analytics SQL COALESCEs nulls to 0. So the assertion must
        // also reject 0 to actually detect the bug — matching the evaluation_score
        // test above. (NaN is included for safety in case future SQL changes.)
        const passRate = Number(currentRows[0]?.[metricKey!]);
        expect(
          isNaN(passRate) || passRate === 0,
          `Pass rate was ${passRate} — offline boolean evaluation rows were dropped by the JOIN (bug #3900)`,
        ).toBe(false);
      });
    });
  });
});
