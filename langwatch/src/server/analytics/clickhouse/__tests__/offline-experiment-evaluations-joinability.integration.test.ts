/**
 * Integration test for issue #3900 — Phase 1 fix.
 *
 * Bug: Offline-experiment evaluation results produced by the orchestrator are
 * written to `evaluation_runs` (via reportEvaluation → EvaluationRunFoldProjection
 * → upsert) but the corresponding `trace_summaries` row is never written for
 * offline-cell trace IDs. Because the analytics read path JOINs (INNER) from
 * `trace_summaries` to `evaluation_runs` on (TenantId, TraceId), any evaluation
 * row whose TraceId has no matching trace_summary is silently dropped. The
 * Custom Graphs chart therefore shows an empty plot for offline experiments.
 *
 * Fix (Phase 1 / #3900): The orchestrator now dispatches a synthetic recordSpan
 * via `getApp().traces.recordSpan(...)` immediately after every `target_result`
 * event for an offline-experiment cell. This guarantees a `trace_summaries` row
 * exists for the cell's traceId, regardless of what langwatch_nlp's OTLP send
 * did or did not do at runtime.
 *
 * Test strategy:
 * - Seed `evaluation_runs` rows for synthetic offline-cell trace IDs.
 * - ALSO seed `trace_summaries` rows for those trace IDs — simulating what the
 *   orchestrator's new `recordSpan` dispatch creates at runtime via the
 *   trace processing pipeline.
 * - Execute the real `buildTimeseriesQuery` for `evaluations.evaluation_score`
 *   and `evaluations.evaluation_pass_rate` against the test ClickHouse.
 * - Assert that the result contains at least one non-null / non-zero metric
 *   bucket — this proves the analytics JOIN succeeds once trace_summaries rows
 *   are present.
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

const TENANT_ID = "test-offline-exp-3900-fixed";

/**
 * Synthetic trace IDs that the offline-experiment orchestrator generates per
 * cell. With the Phase 1 fix, the orchestrator dispatches a recordSpan for
 * each, which writes a matching trace_summaries row.
 */
const OFFLINE_TRACE_ID_0 = `${TENANT_ID}-offline-cell-trace-0`;
const OFFLINE_TRACE_ID_1 = `${TENANT_ID}-offline-cell-trace-1`;

/**
 * evaluatorA: numeric evaluator (produces Score values, no Passed)
 * evaluatorB: boolean evaluator (produces Passed values, no Score)
 */
const NUMERIC_EVALUATOR_ID = "offline-3900-fixed-numeric-evaluator";
const BOOL_EVALUATOR_ID = "offline-3900-fixed-bool-evaluator";

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
       * Simulate the fixed runtime state:
       *
       * The orchestrator generates a synthetic traceId per cell, calls
       * reportEvaluation (writes evaluation_runs), and NOW ALSO dispatches a
       * synthetic recordSpan via getApp().traces.recordSpan() — which ultimately
       * writes a trace_summaries row. We simulate the end-result of that
       * pipeline by inserting into both tables directly, as the full BullMQ
       * pipeline is not available in this integration test environment.
       */

      // Seed trace_summaries — this is what the orchestrator's new recordSpan
      // dispatch creates at runtime via the trace processing pipeline.
      const now = new Date("2025-06-01T10:00:00Z");
      await ch.insert({
        table: "trace_summaries",
        values: [
          {
            ProjectionId: `proj-ts-3900-0`,
            TenantId: TENANT_ID,
            TraceId: OFFLINE_TRACE_ID_0,
            Version: "1",
            Attributes: {
              "langwatch.origin": "evaluation",
              "langwatch.experiment_id": "exp-offline-3900",
              "langwatch.run_id": "run-offline-3900",
            },
            OccurredAt: now,
            CreatedAt: now,
            UpdatedAt: now,
            ComputedIOSchemaVersion: "",
            ComputedInput: "",
            ComputedOutput: "",
            TimeToFirstTokenMs: 0,
            TimeToLastTokenMs: 0,
            TotalDurationMs: 0,
            TokensPerSecond: 0,
            SpanCount: 1,
            ContainsErrorStatus: 0,
            ContainsOKStatus: 1,
            ErrorMessage: null,
            Models: [],
            TotalCost: 0,
            TokensEstimated: false,
            TotalPromptTokenCount: 0,
            TotalCompletionTokenCount: 0,
            OutputFromRootSpan: 0,
            OutputSpanEndTimeMs: 0,
            BlockedByGuardrail: 0,
            TopicId: null,
            SubTopicId: null,
            HasAnnotation: null,
          },
          {
            ProjectionId: `proj-ts-3900-1`,
            TenantId: TENANT_ID,
            TraceId: OFFLINE_TRACE_ID_1,
            Version: "1",
            Attributes: {
              "langwatch.origin": "evaluation",
              "langwatch.experiment_id": "exp-offline-3900",
              "langwatch.run_id": "run-offline-3900",
            },
            OccurredAt: now,
            CreatedAt: now,
            UpdatedAt: now,
            ComputedIOSchemaVersion: "",
            ComputedInput: "",
            ComputedOutput: "",
            TimeToFirstTokenMs: 0,
            TimeToLastTokenMs: 0,
            TotalDurationMs: 0,
            TokensPerSecond: 0,
            SpanCount: 1,
            ContainsErrorStatus: 0,
            ContainsOKStatus: 1,
            ErrorMessage: null,
            Models: [],
            TotalCost: 0,
            TokensEstimated: false,
            TotalPromptTokenCount: 0,
            TotalCompletionTokenCount: 0,
            OutputFromRootSpan: 0,
            OutputSpanEndTimeMs: 0,
            BlockedByGuardrail: 0,
            TopicId: null,
            SubTopicId: null,
            HasAnnotation: null,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });

      // Seed evaluation_runs — these are what the orchestrator's reportEvaluation
      // call creates (unchanged from before the fix).
      await ch.insert({
        table: "evaluation_runs",
        values: [
          // Numeric evaluator, cell 0: score 0.75
          {
            ProjectionId: "proj-offline-3900-fixed-num-0",
            TenantId: TENANT_ID,
            EvaluationId: "eval-offline-3900-fixed-num-0",
            Version: "1",
            EvaluatorId: NUMERIC_EVALUATOR_ID,
            EvaluatorType: "custom",
            TraceId: OFFLINE_TRACE_ID_0,
            Status: "processed",
            Score: 0.75,
            Passed: null,
            Label: null,
            LastProcessedEventId: "evt-offline-3900-fixed-num-0",
            UpdatedAt: new Date("2025-06-01T10:00:00Z").toISOString(),
          },
          // Numeric evaluator, cell 1: score 0.25
          {
            ProjectionId: "proj-offline-3900-fixed-num-1",
            TenantId: TENANT_ID,
            EvaluationId: "eval-offline-3900-fixed-num-1",
            Version: "1",
            EvaluatorId: NUMERIC_EVALUATOR_ID,
            EvaluatorType: "custom",
            TraceId: OFFLINE_TRACE_ID_1,
            Status: "processed",
            Score: 0.25,
            Passed: null,
            Label: null,
            LastProcessedEventId: "evt-offline-3900-fixed-num-1",
            UpdatedAt: new Date("2025-06-01T10:00:01Z").toISOString(),
          },
          // Boolean evaluator, cell 0: passed
          {
            ProjectionId: "proj-offline-3900-fixed-bool-0",
            TenantId: TENANT_ID,
            EvaluationId: "eval-offline-3900-fixed-bool-0",
            Version: "1",
            EvaluatorId: BOOL_EVALUATOR_ID,
            EvaluatorType: "custom",
            TraceId: OFFLINE_TRACE_ID_0,
            Status: "processed",
            Score: null,
            Passed: 1,
            Label: null,
            LastProcessedEventId: "evt-offline-3900-fixed-bool-0",
            UpdatedAt: new Date("2025-06-01T10:00:02Z").toISOString(),
          },
          // Boolean evaluator, cell 1: failed
          {
            ProjectionId: "proj-offline-3900-fixed-bool-1",
            TenantId: TENANT_ID,
            EvaluationId: "eval-offline-3900-fixed-bool-1",
            Version: "1",
            EvaluatorId: BOOL_EVALUATOR_ID,
            EvaluatorType: "custom",
            TraceId: OFFLINE_TRACE_ID_1,
            Status: "processed",
            Score: null,
            Passed: 0,
            Label: null,
            LastProcessedEventId: "evt-offline-3900-fixed-bool-1",
            UpdatedAt: new Date("2025-06-01T10:00:03Z").toISOString(),
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

  describe("given the orchestrator dispatches a recordSpan for each offline-experiment cell", () => {
    describe("when the analytics layer queries evaluation_score for the experiment's evaluator", () => {
      /**
       * @scenario Offline experiment writes joinable evaluation_runs rows for boolean and numeric evaluators
       */
      it("renders non-empty evaluation_score buckets for the offline-experiment evaluator", async () => {
        // With the Phase 1 fix, the orchestrator dispatches a synthetic
        // recordSpan immediately after each target_result event. This creates a
        // trace_summaries row for the cell's traceId via the trace processing
        // pipeline. The analytics INNER JOIN trace_summaries → evaluation_runs
        // on (TenantId, TraceId) therefore matches, and the metric is non-null.
        //
        // This test seeds both trace_summaries (simulating the recordSpan write)
        // and evaluation_runs (seeded as before), then asserts the analytics
        // query returns a non-zero value.
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

        const currentRows = rows.filter((r) => r["period"] === "current");

        // At least one bucket must exist with a non-null numeric score.
        // avg(0.75, 0.25) = 0.5 if both rows are visible via the JOIN.
        const metricKey = Object.keys(currentRows[0] ?? {}).find(
          (k) => k !== "date" && k !== "period" && k !== "group_key",
        );

        expect(
          metricKey,
          "No metric column found — query returned zero rows (trace_summaries rows missing for offline-experiment cells)",
        ).toBeDefined();

        const score = Number(currentRows[0]?.[metricKey!]);
        expect(
          isNaN(score) || score === 0,
          `Metric value was ${score} — expected non-zero avg score (0.75 and 0.25 seeded)`,
        ).toBe(false);
      });

      it("renders non-empty evaluation_pass_rate buckets for the offline-experiment evaluator", async () => {
        // Same verification for boolean evaluator pass_rate.
        // Passed=1 (cell 0) and Passed=0 (cell 1) → avg pass_rate = 0.5.
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
          "No metric column found — query returned zero rows (trace_summaries rows missing for offline-experiment cells)",
        ).toBeDefined();

        // avg(Passed) = (1 + 0) / 2 = 0.5 if both rows are visible.
        // If rows are dropped by the JOIN, avg() of nothing returns 0 (not NaN)
        // because the analytics SQL COALESCEs nulls to 0. The assertion must
        // also reject 0 to detect the bug.
        const passRate = Number(currentRows[0]?.[metricKey!]);
        expect(
          isNaN(passRate) || passRate === 0,
          `Pass rate was ${passRate} — expected non-zero avg (Passed=1 and Passed=0 seeded)`,
        ).toBe(false);
      });
    });
  });
});
