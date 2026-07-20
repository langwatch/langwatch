/**
 * Integration tests for the monitor-card pass-rate read path: legacy shim →
 * `buildTimeseriesQuery` (trace_summaries ⋈ evaluation_runs) → shared row
 * parser, against a real ClickHouse testcontainer.
 *
 * Reproduces the customer-reported divergence: an evaluator with 6/6 passed
 * runs on a single day showed a 25% pass rate on the Evaluations page while
 * the analytics donut said 100%. Day buckets exist for every day ANY
 * evaluator ran; the parser used to default the pass-rate to 0 in buckets
 * where THIS evaluator had no processed runs, and the card averaged the four
 * daily values: (0 + 0 + 0 + 1) / 4 = 25%.
 *
 * Asserts the two contracts the fix relies on:
 *   (a) daily buckets carry NO pass-rate value for days without processed
 *       runs (absent, not 0);
 *   (b) a `timeScale: "full"` read returns the run-weighted rate over the
 *       whole period — the number the card now headlines, and the same
 *       number the donut derives by counting runs.
 *
 * See specs/analytics/evaluation-pass-rate-consistency.feature.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteEvaluationRunsByTenant } from "~/server/analytics/clickhouse/__tests__/test-utils/clickhouse-cleanup";
import type { TimeseriesResult } from "~/server/analytics/types";
import {
  cleanupTestData,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { buildSeriesName } from "../repositories/_timeseries-row-parser";
import { ClickHouseLegacyAnalyticsShim } from "../repositories/legacy.shim";

const tenantId = `test-monitor-rate-${nanoid()}`;

const PII_EVALUATOR_ID = `${tenantId}-pii`;
const OTHER_EVALUATOR_ID = `${tenantId}-compliance`;

// Days are anchored relative to now, never fixed calendar dates: the raw
// ch.insert seeding takes the tables' `_retention_days` DDL default
// (MIGRATION_DEFAULT_RETENTION_DAYS) and rows TTL-delete that many days after
// OccurredAt, so a fixed date eventually ages past the horizon and the
// fixtures silently vanish before the reads.
const DAY_MS = 24 * 60 * 60 * 1000;
const dayString = (daysAgo: number) =>
  new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS - daysAgo * DAY_MS)
    .toISOString()
    .slice(0, 10);
// Four active days inside the query window. PII only runs on the last one.
const DAY_1 = dayString(8);
const DAY_2 = dayString(7);
const DAY_3 = dayString(6);
const PII_DAY = dayString(4);

let ch: ClickHouseClient;
let shim: ClickHouseLegacyAnalyticsShim;

interface SeededEvaluation {
  day: string;
  evaluatorId: string;
  passed: number | null;
  status?: string;
}

function traceSummaryRow(traceId: string, day: string) {
  const occurredAt = new Date(`${day}T12:00:00.000Z`);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: occurredAt,
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TimeToFirstTokenMs: 50,
    TimeToLastTokenMs: 200,
    TotalDurationMs: 200,
    TokensPerSecond: 100,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: ["gpt-5-mini"],
    TotalCost: 0.01,
    TokensEstimated: false,
    TotalPromptTokenCount: 100,
    TotalCompletionTokenCount: 50,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

function evaluationRunRow(
  traceId: string,
  { day, evaluatorId, passed, status = "processed" }: SeededEvaluation,
) {
  const occurredAt = new Date(`${day}T12:00:00.000Z`);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${nanoid()}`,
    Version: "1",
    EvaluatorId: evaluatorId,
    EvaluatorType: "presidio/pii_detection",
    TraceId: traceId,
    Status: status,
    Score: passed === null ? null : passed,
    Passed: passed,
    Label: null,
    LastProcessedEventId: `evt-${nanoid()}`,
    UpdatedAt: occurredAt.toISOString(),
  };
}

/** Repeat a (day, passed) shape `count` times. */
function runs(
  count: number,
  shape: Omit<SeededEvaluation, "status"> & { status?: string },
): SeededEvaluation[] {
  return Array.from({ length: count }, () => ({ ...shape }));
}

const passRateSeries = {
  metric: "evaluations.evaluation_pass_rate" as const,
  aggregation: "avg" as const,
  key: PII_EVALUATOR_ID,
};
const passRateKey = buildSeriesName(passRateSeries, 0);

function queryInput(timeScale: number | "full") {
  return {
    projectId: tenantId,
    startDate: new Date(`${dayString(10)}T00:00:00.000Z`).getTime(),
    endDate: new Date(`${dayString(3)}T00:00:00.000Z`).getTime(),
    filters: {},
    series: [passRateSeries],
    timeScale,
    timeZone: "UTC",
  };
}

function bucketFor(result: TimeseriesResult, day: string) {
  return result.currentPeriod.find((bucket) => bucket.date.startsWith(day));
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  shim = new ClickHouseLegacyAnalyticsShim(async () => ch);

  // The other evaluator creates activity (and therefore day buckets) on three
  // days: 1/10 passed, then 90/90, then 2/4. PII runs only on the fourth day:
  // 6/6 passed, plus non-processed runs that must not count.
  const seeded: SeededEvaluation[] = [
    ...runs(1, { day: DAY_1, evaluatorId: OTHER_EVALUATOR_ID, passed: 1 }),
    ...runs(9, { day: DAY_1, evaluatorId: OTHER_EVALUATOR_ID, passed: 0 }),
    ...runs(90, { day: DAY_2, evaluatorId: OTHER_EVALUATOR_ID, passed: 1 }),
    ...runs(2, { day: DAY_3, evaluatorId: OTHER_EVALUATOR_ID, passed: 1 }),
    ...runs(2, { day: DAY_3, evaluatorId: OTHER_EVALUATOR_ID, passed: 0 }),
    ...runs(6, { day: PII_DAY, evaluatorId: PII_EVALUATOR_ID, passed: 1 }),
    ...runs(2, {
      day: PII_DAY,
      evaluatorId: PII_EVALUATOR_ID,
      passed: null,
      status: "error",
    }),
    ...runs(1, {
      day: PII_DAY,
      evaluatorId: PII_EVALUATOR_ID,
      passed: null,
      status: "skipped",
    }),
  ];

  const traceRows = seeded.map((evaluation, i) =>
    traceSummaryRow(`${tenantId}-trace-${i}`, evaluation.day),
  );
  const evaluationRows = seeded.map((evaluation, i) =>
    evaluationRunRow(`${tenantId}-trace-${i}`, evaluation),
  );

  await ch.insert({
    table: "trace_summaries",
    values: traceRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
  await ch.insert({
    table: "evaluation_runs",
    values: evaluationRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  await cleanupTestData(tenantId);
  await deleteEvaluationRunsByTenant({ client: ch, tenantId });
  await stopTestContainers();
});

describe("monitor pass-rate read path", () => {
  describe("when reading daily buckets for an evaluator that ran on one of four active days", () => {
    let result: TimeseriesResult;

    beforeAll(async () => {
      result = await shim.run(queryInput(1440));
    });

    it("returns a bucket for every day with evaluation activity", () => {
      for (const day of [DAY_1, DAY_2, DAY_3, PII_DAY]) {
        expect(bucketFor(result, day)).toBeDefined();
      }
    });

    it("reports the true rate on the day the evaluator ran", () => {
      expect(bucketFor(result, PII_DAY)?.[passRateKey]).toBe(1);
    });

    it("carries no pass-rate value on days the evaluator never ran", () => {
      for (const day of [DAY_1, DAY_2, DAY_3]) {
        expect(bucketFor(result, day)).not.toHaveProperty(passRateKey);
      }
    });

    it("never fabricates a 0% pass rate (the 25%-instead-of-100% regression)", () => {
      const values = result.currentPeriod.map((bucket) => bucket[passRateKey]);
      expect(values).not.toContain(0);
    });
  });

  describe("when reading the full period as one bucket (the card headline)", () => {
    /** @scenario Card headline matches the analytics donut */
    it("returns 100% for the evaluator whose processed runs all passed", async () => {
      const result = await shim.run(queryInput("full"));
      expect(result.currentPeriod[0]?.[passRateKey]).toBe(1);
    });

    /** @scenario Card headline weighs days by run volume */
    it("returns the run-weighted rate, not the average of daily rates", async () => {
      const result = await shim.run({
        ...queryInput("full"),
        series: [{ ...passRateSeries, key: OTHER_EVALUATOR_ID }],
      });
      const key = buildSeriesName(
        { ...passRateSeries, key: OTHER_EVALUATOR_ID },
        0,
      );
      // 93 of 104 processed runs passed. The unweighted average of the three
      // daily rates would be (0.1 + 1.0 + 0.5) / 3 ≈ 0.533 — the distortion
      // the card used to show.
      expect(result.currentPeriod[0]?.[key]).toBeCloseTo(93 / 104, 5);
    });

    /** @scenario Card shows no data when the evaluator never ran */
    it("carries no value for an evaluator with no runs, so the card shows its no-data state", async () => {
      const ghostSeries = { ...passRateSeries, key: `${tenantId}-ghost` };
      const result = await shim.run({
        ...queryInput("full"),
        series: [ghostSeries],
      });
      const key = buildSeriesName(ghostSeries, 0);
      for (const bucket of result.currentPeriod) {
        expect(bucket).not.toHaveProperty(key);
      }
    });
  });
});
