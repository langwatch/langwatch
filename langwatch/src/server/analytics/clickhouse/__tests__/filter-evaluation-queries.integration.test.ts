/**
 * Regression integration tests for issue #2660.
 *
 * ClickHouse v25.10 planner crashes with "Cannot clone Sorting plan step" when
 * EXISTS subqueries are combined with LIMIT 1 BY in JOINed subqueries. The fix
 * replaced EXISTS with IN subqueries in filter-translator.ts.
 *
 * These tests execute real queries against ClickHouse to confirm the fix holds.
 *
 * @see https://github.com/langwatch/langwatch/issues/2660
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

const TENANT_ID = "test-filter-eval-2660";

/** Base query input shared across all tests */
const baseInput = {
  projectId: TENANT_ID,
  startDate: new Date("2020-01-01T00:00:00Z"),
  endDate: new Date("2030-01-01T00:00:00Z"),
  previousPeriodStartDate: new Date("2019-01-01T00:00:00Z"),
  timeScale: "full" as const,
};

/**
 * Trace IDs seeded by seedSpans follow the pattern `${tenantId}-trace-${t}`.
 * We reference the first two for evaluation_runs.
 */
const TRACE_ID_0 = `${TENANT_ID}-trace-0`;
const TRACE_ID_1 = `${TENANT_ID}-trace-1`;

describe("filter-evaluation-queries", () => {
  let ch: ClickHouseClient;

  beforeAll(
    async () => {
      const rawClient = getTestClickHouseClient();
      if (!rawClient) throw new Error("ClickHouse client not available");
      ch = wrapWithDefaultSettings(rawClient);

      // Seed a small number of traces — just enough to exercise the query paths
      await seedSpans(ch, {
        tenantId: TENANT_ID,
        count: 10,
        attributeKeys: 3,
        traceCount: 5,
      });

      // Seed evaluation_runs rows referencing the seeded traces
      await ch.insert({
        table: "evaluation_runs",
        values: [
          {
            ProjectionId: "proj-eval-2660-1",
            TenantId: TENANT_ID,
            EvaluationId: "eval-2660-1",
            Version: "1",
            EvaluatorId: "test-evaluator-2660",
            EvaluatorType: "custom",
            TraceId: TRACE_ID_0,
            Status: "processed",
            Score: 0.8,
            Passed: 1,
            Label: "PASS",
            LastProcessedEventId: "evt-2660-1",
            UpdatedAt: new Date().toISOString(),
          },
          {
            ProjectionId: "proj-eval-2660-2",
            TenantId: TENANT_ID,
            EvaluationId: "eval-2660-2",
            Version: "1",
            EvaluatorId: "test-evaluator-2660",
            EvaluatorType: "custom",
            TraceId: TRACE_ID_1,
            Status: "processed",
            Score: 0.2,
            Passed: 0,
            Label: "FAIL",
            LastProcessedEventId: "evt-2660-2",
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
        query: `ALTER TABLE evaluation_runs DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: TENANT_ID },
      });
    }
  });

  describe("regression: issue #2660 — IN subqueries with LIMIT 1 BY", () => {
    describe("when evaluations.evaluator_id filter is applied", () => {
      it("executes without ClickHouse planner crash", async () => {
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as AggregationTypes,
            },
          ],
          filters: {
            "evaluations.evaluator_id": ["test-evaluator-2660"],
          },
        });

        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });

        const rows = await result.json();
        expect(Array.isArray(rows)).toBe(true);
      });
    });

    describe("when evaluations.label filter is applied with evaluation groupBy", () => {
      it("executes without ClickHouse planner crash", async () => {
        // This is the exact scenario from the bug report:
        // evaluation label filter + evaluation groupBy + dedupedTraceSummaries (LIMIT 1 BY)
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as AggregationTypes,
            },
          ],
          filters: {
            "evaluations.label": {
              "test-evaluator-2660": ["PASS", "FAIL"],
            },
          },
          groupBy: "evaluations.evaluation_label",
          groupByKey: "test-evaluator-2660",
        });

        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });

        const rows = await result.json();
        expect(Array.isArray(rows)).toBe(true);
      });
    });

    describe("when evaluations.passed filter is applied", () => {
      it("executes without ClickHouse planner crash", async () => {
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as AggregationTypes,
            },
          ],
          filters: {
            "evaluations.passed": ["true"],
          },
        });

        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });

        const rows = await result.json();
        expect(Array.isArray(rows)).toBe(true);
      });
    });

    describe("when spans.type filter is applied with evaluation groupBy", () => {
      it("executes without ClickHouse planner crash", async () => {
        // Cross-table: span filter (IN subquery on stored_spans) +
        // evaluation groupBy (JOIN on evaluation_runs with LIMIT 1 BY)
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as AggregationTypes,
            },
          ],
          filters: {
            "spans.type": ["llm"],
          },
          groupBy: "evaluations.evaluation_label",
          groupByKey: "test-evaluator-2660",
        });

        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });

        const rows = await result.json();
        expect(Array.isArray(rows)).toBe(true);
      });
    });
  });
});
