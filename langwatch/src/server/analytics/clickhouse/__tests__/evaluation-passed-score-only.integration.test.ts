/**
 * Integration coverage for the evaluation_passed groupBy on score-only /
 * non-processed evaluation rows (follow-up on PR #5007 review, issue #5294).
 *
 * A "score-only" evaluation row has a Score but no pass/fail verdict
 * (Passed IS NULL) and can carry a non-terminal Status (Status != 'processed').
 * The evaluation_passed groupBy has two distinct paths for these rows:
 *
 * - WITH groupByKey: the CASE only maps rows where
 *   `Status = 'processed' AND Passed IS NOT NULL` to 'passed'/'failed', ELSE NULL,
 *   and the HAVING clause drops group_key IS NULL. So a score-only /
 *   non-processed row must NOT appear in any pass/fail bucket.
 * - WITHOUT groupByKey: the CASE maps Passed = 1 -> 'passed', Passed = 0 ->
 *   'failed', ELSE 'unknown', and there is no HAVING clause, so a Passed IS NULL
 *   row must be RETAINED under the 'unknown' bucket rather than dropped.
 *
 * These tests execute real queries against ClickHouse to observe the bucketing,
 * not the generated SQL string.
 *
 * @see https://github.com/langwatch/langwatch/issues/5294
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
import { deleteEvaluationRunsByTenant } from "./test-utils/clickhouse-cleanup";

const TENANT_ID = "test-eval-passed-score-only-5294";

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
const TRACE_ID_2 = `${TENANT_ID}-trace-2`;

/** Single evaluator so the WITH-groupByKey CASE matches every seeded row. */
const EVALUATOR_ID = "eval-passed-5294";

type Row = Record<string, unknown>;

const passedGroupByInput = (groupByKey?: string) => ({
  ...baseInput,
  groupBy: "evaluations.evaluation_passed",
  ...(groupByKey ? { groupByKey } : {}),
  series: [
    {
      metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
      aggregation: "cardinality" as AggregationTypes,
    },
  ],
});

async function runGroupKeys(
  ch: ClickHouseClient,
  groupByKey?: string,
): Promise<unknown[]> {
  resetParamCounter();
  const { sql, params } = buildTimeseriesQuery(passedGroupByInput(groupByKey));
  const result = await ch.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Row[];
  return rows
    .filter((r) => r["period"] === "current")
    .map((r) => r["group_key"]);
}

describe("evaluation_passed groupBy on score-only / non-processed rows", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const rawClient = getTestClickHouseClient();
    if (!rawClient) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(rawClient);

    await seedSpans(ch, {
      tenantId: TENANT_ID,
      count: 6,
      attributeKeys: 2,
      traceCount: 3,
    });

    await ch.insert({
      table: "evaluation_runs",
      values: [
        // trace 0: fully processed pass verdict -> 'passed'
        {
          ProjectionId: "proj-5294-passed",
          TenantId: TENANT_ID,
          EvaluationId: "eval-5294-passed",
          Version: "1",
          EvaluatorId: EVALUATOR_ID,
          EvaluatorType: "custom",
          TraceId: TRACE_ID_0,
          Status: "processed",
          Score: 0.9,
          Passed: 1,
          Label: "PASS",
          LastProcessedEventId: "evt-5294-passed",
          UpdatedAt: new Date().toISOString(),
        },
        // trace 1: fully processed fail verdict -> 'failed'
        {
          ProjectionId: "proj-5294-failed",
          TenantId: TENANT_ID,
          EvaluationId: "eval-5294-failed",
          Version: "1",
          EvaluatorId: EVALUATOR_ID,
          EvaluatorType: "custom",
          TraceId: TRACE_ID_1,
          Status: "processed",
          Score: 0.1,
          Passed: 0,
          Label: "FAIL",
          LastProcessedEventId: "evt-5294-failed",
          UpdatedAt: new Date().toISOString(),
        },
        // trace 2: score-only, non-processed -> Passed IS NULL, Status != 'processed'
        {
          ProjectionId: "proj-5294-score-only",
          TenantId: TENANT_ID,
          EvaluationId: "eval-5294-score-only",
          Version: "1",
          EvaluatorId: EVALUATOR_ID,
          EvaluatorType: "custom",
          TraceId: TRACE_ID_2,
          Status: "skipped",
          Score: 0.5,
          Passed: null,
          Label: null,
          LastProcessedEventId: "evt-5294-score-only",
          UpdatedAt: new Date().toISOString(),
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 60_000);

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);
    await deleteEvaluationRunsByTenant({ client: ch, tenantId: TENANT_ID });
  });

  describe("when there is no groupByKey", () => {
    it("buckets the score-only Passed IS NULL row under 'unknown' and retains it", async () => {
      const groupKeys = await runGroupKeys(ch);

      // The processed verdicts still bucket normally.
      expect(groupKeys).toContain("passed");
      expect(groupKeys).toContain("failed");
      // The score-only / non-processed row is not dropped: with no HAVING clause
      // its Passed IS NULL value falls into the CASE ELSE 'unknown' bucket.
      expect(groupKeys).toContain("unknown");
    });
  });

  describe("when a groupByKey is set", () => {
    it("excludes the score-only non-processed row from the pass/fail buckets", async () => {
      const groupKeys = await runGroupKeys(ch, EVALUATOR_ID);

      // Processed verdicts for this evaluator still bucket into passed/failed.
      expect(groupKeys).toContain("passed");
      expect(groupKeys).toContain("failed");
      // The CASE requires Status = 'processed' AND Passed IS NOT NULL, so the
      // score-only non-processed row maps to NULL and the HAVING group_key IS
      // NOT NULL clause drops it: no 'unknown' bucket and no null group_key.
      expect(groupKeys).not.toContain("unknown");
      expect(groupKeys).not.toContain(null);
    });
  });
});
