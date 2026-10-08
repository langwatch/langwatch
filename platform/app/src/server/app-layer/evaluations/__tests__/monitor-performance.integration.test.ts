/**
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
 * @see specs/evaluations/category-evaluator-performance.feature
 *
 * The Online Evaluations table and the analytics page must publish the same
 * numbers. The analytics page reads evaluations through the trace-anchored
 * legacy path, so besides pinning the table's own expected values, this
 * suite reads the seeded dataset through both paths and asserts they agree
 * on the headline, the previous period, and every daily bucket.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteEvaluationRunsByTenant } from "~/server/analytics/clickhouse/__tests__/test-utils/clickhouse-cleanup";
import { currentVsPreviousDates } from "~/server/api/routers/analytics/common";
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
import {
  buildSeedMatrix,
  readAnalyticsPageNumbers,
  type SeededEvaluation,
  seedMonitorPerformance,
} from "./monitor-performance.fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-monitor-performance-${nanoid()}`;
const scoreEvaluatorId = `${tenantId}-score`;
const guardrailEvaluatorId = `${tenantId}-guardrail`;
const categoryEvaluatorId = `${tenantId}-category`;
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

/**
 * A classifier: every result carries a label and neither a score nor a pass
 * flag, which is exactly the shape that used to read as no data at all.
 */
const categorySeeds = (): SeededEvaluation[] => {
  const half = DAY_MS / 2;
  const at = (startMs: number, dayOffset: number) =>
    startMs + dayOffset * DAY_MS + half;
  const run = (occurredAtMs: number, label: string): SeededEvaluation => ({
    traceId: `${categoryEvaluatorId}-trace-${nanoid()}`,
    traceOccurredAtMs: occurredAtMs,
    scheduledAtMs: occurredAtMs,
    evaluatorId: categoryEvaluatorId,
    score: null,
    passed: null,
    label,
  });

  return [
    run(at(currentStartMs, 1), "resolved"),
    run(at(currentStartMs, 1), "resolved"),
    run(at(currentStartMs, 2), "resolved"),
    run(at(currentStartMs, 2), "escalated"),
    run(at(previousStartMs, 1), "resolved"),
    run(at(previousStartMs, 1), "escalated"),
    run(at(previousStartMs, 2), "escalated"),
    run(at(previousStartMs, 2), "escalated"),
  ];
};

beforeAll(async () => {
  const containers = await startTestContainers();
  clickHouse = containers.clickHouseClient;

  await seedMonitorPerformance({
    client: clickHouse,
    tenantId,
    seeded: [
      ...buildSeedMatrix({
        tenantId,
        scoreEvaluatorId,
        guardrailEvaluatorId,
        currentStartMs,
        previousStartMs,
      }),
      ...categorySeeds(),
    ],
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

  describe("when a monitor classifies its results instead of scoring them", () => {
    /** @scenario "Label counts are read per day and period" */
    it("carries the count of each label produced on each day", async () => {
      const repository = new MonitorPerformanceClickHouseRepository(
        async () => clickHouse,
      );
      const buckets = await repository.findBuckets({
        tenantId,
        evaluatorIds: [categoryEvaluatorId],
        previousStartMs,
        currentStartMs,
        endMs,
        timeZone: "UTC",
      });

      const current = buckets.filter((bucket) => bucket.period === "current");
      expect(current.map((bucket) => bucket.labelCounts)).toEqual([
        { resolved: 2 },
        { resolved: 1, escalated: 1 },
      ]);
      // Nothing to average: this is the shape that used to read as no data.
      expect(current.every((bucket) => bucket.scoreCount === 0)).toBe(true);
      expect(current.every((bucket) => bucket.passCount === 0)).toBe(true);
    });

    it("summarizes the period as a label distribution with a real comparison", async () => {
      const service = new MonitorPerformanceService(
        new MonitorPerformanceClickHouseRepository(async () => clickHouse),
      );
      const [performance] = await service.getPerformance({
        tenantId,
        monitors: [{ id: categoryEvaluatorId, isGuardrail: false }],
        previousStartMs,
        currentStartMs,
        endMs,
        timeZone: "UTC",
      });

      expect(performance).toEqual({
        monitorId: categoryEvaluatorId,
        metric: "label",
        labels: [
          { label: "resolved", count: 3, share: 0.75 },
          { label: "escalated", count: 1, share: 0.25 },
        ],
        current: 0.75,
        previous: 0.25,
      });
    });
  });

  describe("when the analytics page reads the same period", () => {
    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same score values as the analytics page", async () => {
      const [scorePerformance] = await readTablePerformance();
      if (scorePerformance?.metric !== "score") {
        throw new Error("expected a score metric");
      }
      const analyticsPage = await readAnalyticsPageNumbers({
        client: clickHouse,
        tenantId,
        evaluatorId: scoreEvaluatorId,
        metric: "evaluations.evaluation_score",
        currentStartMs,
        endMs,
      });

      expectSameNumbers({ table: scorePerformance, analyticsPage });
    });

    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same pass rate as the analytics page", async () => {
      const [, guardrailPerformance] = await readTablePerformance();
      if (guardrailPerformance?.metric !== "pass_rate") {
        throw new Error("expected a pass rate metric");
      }
      const analyticsPage = await readAnalyticsPageNumbers({
        client: clickHouse,
        tenantId,
        evaluatorId: guardrailEvaluatorId,
        metric: "evaluations.evaluation_pass_rate",
        currentStartMs,
        endMs,
      });

      expectSameNumbers({ table: guardrailPerformance, analyticsPage });
    });
  });
});
