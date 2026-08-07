/**
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
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
  seedMonitorPerformance,
} from "./monitor-performance.fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
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

/**
 * Both sides projected to 10-decimal-rounded views so one `toEqual` compares
 * them (matching the old toBeCloseTo(…, 10) tolerance). The analytics side
 * maps null to a sentinel so a data-less analytics page still fails loudly
 * instead of matching a null table value.
 */
const round10 = (value: number | null) =>
  value === null ? null : Number(value.toFixed(10));

const sameNumbersViews = ({
  table,
  analyticsPage,
}: {
  table: { current: number | null; previous: number | null; points: number[] };
  analyticsPage: {
    current: number | null;
    previous: number | null;
    dailyValues: number[];
  };
}) => ({
  table: {
    current: round10(table.current),
    previous: round10(table.previous),
    values: table.points.map(round10),
  },
  analytics: {
    current:
      analyticsPage.current === null
        ? "<missing>"
        : round10(analyticsPage.current),
    previous:
      analyticsPage.previous === null
        ? "<missing>"
        : round10(analyticsPage.previous),
    values: analyticsPage.dailyValues.map(round10),
  },
});

beforeAll(async () => {
  const containers = await startTestContainers();
  clickHouse = containers.clickHouseClient;

  await seedMonitorPerformance({
    client: clickHouse,
    tenantId,
    seeded: buildSeedMatrix({
      tenantId,
      scoreEvaluatorId,
      guardrailEvaluatorId,
      currentStartMs,
      previousStartMs,
    }),
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
        client: clickHouse,
        tenantId,
        evaluatorId: scoreEvaluatorId,
        metric: "evaluations.evaluation_score",
        currentStartMs,
        endMs,
      });

      const views = sameNumbersViews({
        table: scorePerformance!,
        analyticsPage,
      });
      expect(views.table).toEqual(views.analytics);
    });

    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same pass rate as the analytics page", async () => {
      const [, guardrailPerformance] = await readTablePerformance();
      const analyticsPage = await readAnalyticsPageNumbers({
        client: clickHouse,
        tenantId,
        evaluatorId: guardrailEvaluatorId,
        metric: "evaluations.evaluation_pass_rate",
        currentStartMs,
        endMs,
      });

      const views = sameNumbersViews({
        table: guardrailPerformance!,
        analyticsPage,
      });
      expect(views.table).toEqual(views.analytics);
    });
  });
});
