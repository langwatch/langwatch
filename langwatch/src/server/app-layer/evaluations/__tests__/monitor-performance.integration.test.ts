/**
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
 *
 * The Online Evaluations table and the analytics page must publish the same
 * numbers. The analytics page reads evaluations through the trace-anchored
 * legacy path (`ClickHouseLegacyAnalyticsShim`), so besides pinning the
 * table's own expected values, this suite runs the shim with the exact
 * series the analytics page issues and asserts both read paths agree on the
 * headline, the previous period, and every daily bucket.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteEvaluationRunsByTenant } from "~/server/analytics/clickhouse/__tests__/test-utils/clickhouse-cleanup";
import type { SeriesInputType } from "~/server/analytics/registry";
import { currentVsPreviousDates } from "~/server/api/routers/analytics/common";
import { buildSeriesName } from "~/server/app-layer/analytics/repositories/_timeseries-row-parser";
import { ClickHouseLegacyAnalyticsShim } from "~/server/app-layer/analytics/repositories/legacy.shim";
import {
  cleanupTestData,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  MonitorPerformanceService,
  summarizeMonitorPerformance,
} from "../monitor-performance.service";
import { MonitorPerformanceClickHouseRepository } from "../repositories/monitor-performance.clickhouse.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_DAY_MS = 12 * 60 * 60 * 1000;
const tenantId = `test-monitor-performance-${nanoid()}`;
const scoreEvaluatorId = `${tenantId}-score`;
const guardrailEvaluatorId = `${tenantId}-guardrail`;
const endMs = Date.now();
const currentStartMs = endMs - 7 * DAY_MS;
// Derived through the same helper the router and the analytics page use, so
// the comparison below covers the identical previous window on both paths.
const previousStartMs = currentVsPreviousDates({
  projectId: "envelope",
  startDate: currentStartMs,
  endDate: endMs,
  filters: {},
}).previousPeriodStartDate.getTime();

let clickHouse: ClickHouseClient;
let queryCount = 0;

interface SeededEvaluation {
  traceId: string;
  /** When the trace occurred; omitted to leave the run without a trace. */
  traceOccurredAtMs?: number;
  scheduledAtMs: number;
  evaluatorId: string;
  score: number | null;
  passed: number | null;
  status?: string;
  evaluationId?: string;
  updatedAtMs?: number;
}

const traceSummaryRow = ({
  traceId,
  occurredAtMs,
}: {
  traceId: string;
  occurredAtMs: number;
}) => {
  const occurredAt = new Date(occurredAtMs);
  return {
    ProjectionId: `projection-${nanoid()}`,
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
};

const evaluationRunRow = ({
  traceId,
  scheduledAtMs,
  evaluatorId,
  score,
  passed,
  status = "processed",
  evaluationId = `eval-${nanoid()}`,
  updatedAtMs = scheduledAtMs,
}: SeededEvaluation) => ({
  ProjectionId: `projection-${nanoid()}`,
  TenantId: tenantId,
  EvaluationId: evaluationId,
  Version: "1",
  EvaluatorId: evaluatorId,
  EvaluatorType: "langevals/test",
  TraceId: traceId,
  Status: status,
  Score: score,
  Passed: passed,
  Label: null,
  ScheduledAt: new Date(scheduledAtMs),
  UpdatedAt: new Date(updatedAtMs),
  LastProcessedEventId: `event-${nanoid()}`,
});

const countingClient = () =>
  new Proxy(clickHouse, {
    get(target, property, receiver) {
      if (property === "query") {
        return (params: Parameters<ClickHouseClient["query"]>[0]) => {
          queryCount++;
          return target.query(params);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

const finiteOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

type AnalyticsPageMetric =
  | "evaluations.evaluation_score"
  | "evaluations.evaluation_pass_rate";

const analyticsPageSeries = ({
  evaluatorId,
  metric,
}: {
  evaluatorId: string;
  metric: AnalyticsPageMetric;
}): SeriesInputType => ({
  metric,
  aggregation: "avg",
  key: evaluatorId,
  filters: {
    "evaluations.state": {
      [evaluatorId]: ["processed"],
    },
  },
});

const readAnalyticsPageNumbers = async ({
  evaluatorId,
  metric,
}: {
  evaluatorId: string;
  metric: AnalyticsPageMetric;
}) => {
  const shim = new ClickHouseLegacyAnalyticsShim(async () => clickHouse);
  const series = analyticsPageSeries({ evaluatorId, metric });
  const baseInput = {
    projectId: tenantId,
    startDate: currentStartMs,
    endDate: endMs,
    filters: {},
    series: [series],
    timeZone: "UTC",
  };
  const [daily, full] = await Promise.all([
    shim.run({ ...baseInput, timeScale: 24 * 60 }),
    shim.run({ ...baseInput, timeScale: "full" }),
  ]);
  const key = buildSeriesName(series, 0);

  return {
    current: finiteOrNull(full.currentPeriod[0]?.[key]),
    previous: finiteOrNull(full.previousPeriod[0]?.[key]),
    dailyValues: daily.currentPeriod
      .map((bucket) => finiteOrNull(bucket[key]))
      .filter((value): value is number => value !== null),
  };
};

const readTablePerformance = async () => {
  const service = new MonitorPerformanceService(
    new MonitorPerformanceClickHouseRepository(async () => clickHouse),
  );
  return service.getPerformance({
    tenantId,
    monitors: [
      { id: scoreEvaluatorId, isGuardrail: false },
      { id: guardrailEvaluatorId, isGuardrail: true },
    ],
    previousStartMs,
    currentStartMs,
    endMs,
    timeZone: "UTC",
  });
};

const expectSameNumbers = ({
  table,
  analyticsPage,
}: {
  table: { current: number | null; previous: number | null; points: number[] };
  analyticsPage: {
    current: number | null;
    previous: number | null;
    dailyValues: number[];
  };
}) => {
  expect(analyticsPage.current).not.toBeNull();
  expect(analyticsPage.previous).not.toBeNull();
  expect(table.current).toBeCloseTo(analyticsPage.current!, 10);
  expect(table.previous).toBeCloseTo(analyticsPage.previous!, 10);
  expect(table.points).toHaveLength(analyticsPage.dailyValues.length);
  table.points.forEach((point, index) => {
    expect(point).toBeCloseTo(analyticsPage.dailyValues[index]!, 10);
  });
};

beforeAll(async () => {
  const containers = await startTestContainers();
  clickHouse = containers.clickHouseClient;

  const correctedEvaluationId = `corrected-${nanoid()}`;
  const correctedTraceId = `${tenantId}-trace-corrected`;
  const day1Ms = currentStartMs + DAY_MS + HALF_DAY_MS;
  const day2Ms = currentStartMs + 2 * DAY_MS + HALF_DAY_MS;
  const day3Ms = currentStartMs + 3 * DAY_MS + HALF_DAY_MS;

  const seeded: SeededEvaluation[] = [
    // Day 1 carries uneven scores so the daily average differs from the
    // run-weighted period average.
    {
      traceId: `${tenantId}-trace-1`,
      traceOccurredAtMs: day1Ms,
      scheduledAtMs: day1Ms + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.2,
      passed: 0,
    },
    {
      traceId: `${tenantId}-trace-2`,
      traceOccurredAtMs: day1Ms,
      scheduledAtMs: day1Ms + 120_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.8,
      passed: 1,
    },
    {
      traceId: `${tenantId}-trace-3`,
      traceOccurredAtMs: day2Ms,
      scheduledAtMs: day2Ms + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 1,
      passed: 1,
    },
    // A corrected evaluation: only the latest revision may count.
    {
      traceId: correctedTraceId,
      traceOccurredAtMs: day3Ms,
      scheduledAtMs: day3Ms + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.1,
      passed: 0,
      evaluationId: correctedEvaluationId,
    },
    {
      traceId: correctedTraceId,
      scheduledAtMs: day3Ms + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.9,
      passed: 1,
      evaluationId: correctedEvaluationId,
      updatedAtMs: day3Ms + 61_000,
    },
    // Previous-period run.
    {
      traceId: `${tenantId}-trace-previous`,
      traceOccurredAtMs: currentStartMs - 2 * DAY_MS,
      scheduledAtMs: currentStartMs - 2 * DAY_MS + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.4,
      passed: 0,
    },
    // The trace occurred in the previous period but the evaluation only ran
    // during the current one: both surfaces count it in the previous period
    // because a run belongs to the day its trace occurred.
    {
      traceId: `${tenantId}-trace-late-eval`,
      traceOccurredAtMs: currentStartMs - DAY_MS,
      scheduledAtMs: currentStartMs + 4 * DAY_MS,
      evaluatorId: scoreEvaluatorId,
      score: 0.6,
      passed: 1,
    },
    // Non-processed run: excluded everywhere.
    {
      traceId: `${tenantId}-trace-error`,
      traceOccurredAtMs: day2Ms,
      scheduledAtMs: day2Ms + 90_000,
      evaluatorId: scoreEvaluatorId,
      score: null,
      passed: null,
      status: "error",
    },
    // Run without any trace summary: excluded everywhere.
    {
      traceId: `${tenantId}-trace-missing`,
      scheduledAtMs: day2Ms + 100_000,
      evaluatorId: scoreEvaluatorId,
      score: 0,
      passed: 0,
    },
    // Trace outside the whole comparison window: excluded everywhere even
    // though the evaluation was scheduled inside the current period.
    {
      traceId: `${tenantId}-trace-out-of-window`,
      traceOccurredAtMs: previousStartMs - DAY_MS,
      scheduledAtMs: currentStartMs + DAY_MS,
      evaluatorId: scoreEvaluatorId,
      score: 0.05,
      passed: 0,
    },
    // Guardrail runs.
    {
      traceId: `${tenantId}-trace-guard-1`,
      traceOccurredAtMs: day1Ms,
      scheduledAtMs: day1Ms + 60_000,
      evaluatorId: guardrailEvaluatorId,
      score: null,
      passed: 1,
    },
    {
      traceId: `${tenantId}-trace-guard-2`,
      traceOccurredAtMs: day1Ms,
      scheduledAtMs: day1Ms + 120_000,
      evaluatorId: guardrailEvaluatorId,
      score: null,
      passed: 0,
    },
    {
      traceId: `${tenantId}-trace-guard-previous`,
      traceOccurredAtMs: currentStartMs - 3 * DAY_MS,
      scheduledAtMs: currentStartMs - 3 * DAY_MS + 60_000,
      evaluatorId: guardrailEvaluatorId,
      score: null,
      passed: 1,
    },
    {
      traceId: `${tenantId}-trace-guard-error`,
      traceOccurredAtMs: day2Ms,
      scheduledAtMs: day2Ms + 60_000,
      evaluatorId: guardrailEvaluatorId,
      score: null,
      passed: null,
      status: "error",
    },
  ];

  const traceRows = seeded
    .filter((evaluation) => evaluation.traceOccurredAtMs !== undefined)
    .map((evaluation) =>
      traceSummaryRow({
        traceId: evaluation.traceId,
        occurredAtMs: evaluation.traceOccurredAtMs!,
      }),
    );
  const evaluationRows = seeded.map(evaluationRunRow);

  await clickHouse.insert({
    table: "trace_summaries",
    values: traceRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
  await clickHouse.insert({
    table: "evaluation_runs",
    values: evaluationRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 180_000);

afterAll(async () => {
  await cleanupTestData(tenantId);
  await deleteEvaluationRunsByTenant({ client: clickHouse, tenantId });
  await stopTestContainers();
});

describe("online evaluation monitor performance", () => {
  /** @scenario Performance for every monitor is read in one bounded query */
  it("loads current and previous performance with one real ClickHouse query", async () => {
    queryCount = 0;
    const repository = new MonitorPerformanceClickHouseRepository(async () =>
      countingClient(),
    );
    const service = new MonitorPerformanceService(repository);
    const performance = await service.getPerformance({
      tenantId,
      monitors: [
        { id: scoreEvaluatorId, isGuardrail: false },
        { id: guardrailEvaluatorId, isGuardrail: true },
      ],
      previousStartMs,
      currentStartMs,
      endMs,
      timeZone: "UTC",
    });

    expect(queryCount).toBe(1);
    expect(performance).toEqual([
      {
        monitorId: scoreEvaluatorId,
        metric: "score",
        points: [0.5, 1, 0.9],
        current: 0.725,
        previous: 0.5,
      },
      {
        monitorId: guardrailEvaluatorId,
        metric: "pass_rate",
        points: [0.5],
        current: 0.5,
        previous: 1,
      },
    ]);
  });

  it("returns an explicit no-data result for a monitor without runs", async () => {
    const repository = new MonitorPerformanceClickHouseRepository(
      async () => clickHouse,
    );
    const buckets = await repository.findBuckets({
      tenantId,
      evaluatorIds: [`${tenantId}-empty`],
      previousStartMs,
      currentStartMs,
      endMs,
      timeZone: "UTC",
    });

    expect(
      summarizeMonitorPerformance({
        monitors: [{ id: `${tenantId}-empty`, isGuardrail: false }],
        buckets,
      }),
    ).toEqual([
      {
        monitorId: `${tenantId}-empty`,
        metric: "score",
        points: [],
        current: null,
        previous: null,
      },
    ]);
  });

  describe("when the analytics page reads the same period", () => {
    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same score values as the analytics page", async () => {
      const [scorePerformance] = await readTablePerformance();
      const analyticsPage = await readAnalyticsPageNumbers({
        evaluatorId: scoreEvaluatorId,
        metric: "evaluations.evaluation_score",
      });

      expectSameNumbers({ table: scorePerformance!, analyticsPage });
    });

    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same pass rate as the analytics page", async () => {
      const [, guardrailPerformance] = await readTablePerformance();
      const analyticsPage = await readAnalyticsPageNumbers({
        evaluatorId: guardrailEvaluatorId,
        metric: "evaluations.evaluation_pass_rate",
      });

      expectSameNumbers({ table: guardrailPerformance!, analyticsPage });
    });
  });
});
