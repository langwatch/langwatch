/**
 * Regression integration tests for issue #2674.
 *
 * Bug: `buildTimeseriesQuery` with `groupBy: "evaluations.evaluation_passed"` and
 * a `groupByKey` (a specific EvaluatorId) uses a CASE expression that returned
 * `ELSE NULL` for any row that was not a clear pass (Passed=1) or fail (Passed=0).
 *
 * `buildGroupKeyHavingClause` then adds `HAVING group_key IS NOT NULL`, which
 * intentionally drops rows from OTHER evaluators (foreign-evaluator isolation,
 * regression #2668). However, it also dropped "score-only" rows — rows belonging
 * to the TARGET evaluator that ran successfully (Status='processed') but have
 * `Passed IS NULL` (a numeric score with no pass/fail threshold).
 *
 * The fix adds a new WHEN clause before `ELSE NULL`:
 *   WHEN EvaluatorId = {groupByKey:String} AND Status = 'processed' THEN 'unknown'
 *
 * This buckets score-only rows for the target evaluator as 'unknown' (matching the
 * no-groupByKey branch behaviour) while rows from foreign evaluators and
 * non-processed rows still hit `ELSE NULL` and are dropped by the HAVING clause,
 * preserving the #2668 isolation guarantee.
 *
 * @see https://github.com/langwatch/langwatch/issues/2674
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import type { AggregationTypes } from "../../types";
import { buildTimeseriesQuery } from "../aggregation-builder";
import { resetParamCounter } from "../filter-translator";
import { seedSpans } from "./test-utils/clickhouse-fixtures";

const TENANT_ID = "test-score-only-2674";

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
 * SCORE_ONLY_EVALUATOR_ID: produces numeric scores only — Passed is always NULL.
 *   These rows should appear as 'unknown' in evaluation_passed groupBy (not dropped).
 * PASSFAIL_EVALUATOR_ID: produces pass/fail results — Passed is 0 or 1.
 *   These rows should appear as 'passed' or 'failed'.
 */
const SCORE_ONLY_EVALUATOR_ID = "score-only-2674-scoreonly";
const PASSFAIL_EVALUATOR_ID = "score-only-2674-passfail";

describe("score-only-evaluator-passed-groupby", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
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
        // Score-only evaluator trace 0: processed, Score=0.7, Passed=null
        {
          ProjectionId: "proj-so2674-so0",
          TenantId: TENANT_ID,
          EvaluationId: "eval-so2674-so0",
          Version: "1",
          EvaluatorId: SCORE_ONLY_EVALUATOR_ID,
          EvaluatorType: "custom",
          TraceId: TRACE_ID_0,
          Status: "processed",
          Score: 0.7,
          Passed: null,
          Label: null,
          LastProcessedEventId: "evt-so2674-so0",
          UpdatedAt: new Date().toISOString(),
        },
        // Score-only evaluator trace 1: processed, Score=0.4, Passed=null
        {
          ProjectionId: "proj-so2674-so1",
          TenantId: TENANT_ID,
          EvaluationId: "eval-so2674-so1",
          Version: "1",
          EvaluatorId: SCORE_ONLY_EVALUATOR_ID,
          EvaluatorType: "custom",
          TraceId: TRACE_ID_1,
          Status: "processed",
          Score: 0.4,
          Passed: null,
          Label: null,
          LastProcessedEventId: "evt-so2674-so1",
          UpdatedAt: new Date().toISOString(),
        },
        // Pass/fail evaluator trace 0: processed, Score=0.9, Passed=1
        {
          ProjectionId: "proj-so2674-pf0",
          TenantId: TENANT_ID,
          EvaluationId: "eval-so2674-pf0",
          Version: "1",
          EvaluatorId: PASSFAIL_EVALUATOR_ID,
          EvaluatorType: "custom",
          TraceId: TRACE_ID_0,
          Status: "processed",
          Score: 0.9,
          Passed: 1,
          Label: null,
          LastProcessedEventId: "evt-so2674-pf0",
          UpdatedAt: new Date().toISOString(),
        },
        // Pass/fail evaluator trace 1: processed, Score=0.1, Passed=0
        {
          ProjectionId: "proj-so2674-pf1",
          TenantId: TENANT_ID,
          EvaluationId: "eval-so2674-pf1",
          Version: "1",
          EvaluatorId: PASSFAIL_EVALUATOR_ID,
          EvaluatorType: "custom",
          TraceId: TRACE_ID_1,
          Status: "processed",
          Score: 0.1,
          Passed: 0,
          Label: null,
          LastProcessedEventId: "evt-so2674-pf1",
          UpdatedAt: new Date().toISOString(),
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 60_000);

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

  describe("regression: issue #2674 — score-only evaluator rows dropped by HAVING group_key IS NOT NULL", () => {
    describe("given a score-only evaluator (Passed IS NULL)", () => {
      describe("when grouping evaluation_passed by a score-only evaluator", () => {
        it("includes score-only rows as an 'unknown' group instead of dropping them", async () => {
          resetParamCounter();
          const { sql, params } = buildTimeseriesQuery({
            ...baseInput,
            groupBy: "evaluations.evaluation_passed",
            groupByKey: SCORE_ONLY_EVALUATOR_ID,
            series: [
              {
                metric:
                  "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
                aggregation: "avg" as AggregationTypes,
                key: SCORE_ONLY_EVALUATOR_ID,
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

          const currentRows = rows.filter((r) => r.period === "current");

          // THE core assertion — fails before fix (rows had NULL group_key → HAVING dropped them)
          const unknownRows = currentRows.filter(
            (r) => r.group_key === "unknown",
          );
          expect(unknownRows.length).toBeGreaterThan(0);

          // Score-only evaluator produces no pass or fail groups
          expect(
            currentRows.filter(
              (r) => r.group_key === "passed" || r.group_key === "failed",
            ),
          ).toHaveLength(0);

          // The only non-null group present is 'unknown' (foreign evaluator rows are still NULL→dropped)
          const keys = [...new Set(currentRows.map((r) => r.group_key))];
          expect(keys).toEqual(["unknown"]);
        });
      });
    });

    describe("given a pass/fail evaluator (Passed = 0 or 1)", () => {
      describe("when grouping evaluation_passed by a pass/fail evaluator", () => {
        it("groups rows into passed and failed correctly", async () => {
          resetParamCounter();
          const { sql, params } = buildTimeseriesQuery({
            ...baseInput,
            groupBy: "evaluations.evaluation_passed",
            groupByKey: PASSFAIL_EVALUATOR_ID,
            series: [
              {
                metric:
                  "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
                aggregation: "avg" as AggregationTypes,
                key: PASSFAIL_EVALUATOR_ID,
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

          const currentRows = rows.filter((r) => r.period === "current");

          const passedRows = currentRows.filter(
            (r) => r.group_key === "passed",
          );
          const failedRows = currentRows.filter(
            (r) => r.group_key === "failed",
          );

          expect(passedRows.length).toBeGreaterThan(0);
          expect(failedRows.length).toBeGreaterThan(0);

          // A pass/fail evaluator yields no 'unknown' group — isolation is explicit here, not just implicit
          expect(
            currentRows.filter((r) => r.group_key === "unknown"),
          ).toHaveLength(0);

          const metricKey = Object.keys(passedRows[0]!).find(
            (k) => k !== "date" && k !== "period" && k !== "group_key",
          );
          expect(metricKey).toBeDefined();

          // PASSFAIL trace 0 (Passed=1) has score 0.9; trace 1 (Passed=0) has score 0.1
          expect(Number(passedRows[0]![metricKey!])).toBeCloseTo(0.9);
          expect(Number(failedRows[0]![metricKey!])).toBeCloseTo(0.1);
        });
      });
    });
  });
});
