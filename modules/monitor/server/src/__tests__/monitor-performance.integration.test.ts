/**
 * @vitest-environment node
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
 */

// The Online Evaluations table loads every monitor's trend in one bounded
// ClickHouse read, and publishes the same numbers the analytics page does.
// The seeded dataset carries every way those two could diverge.

import type { ClickHouseClient } from "@clickhouse/client";
import { AnalyticsComparisonWindowService } from "@langwatch/analytics-server";
import {
  MonitorPerformanceAdapter,
  type EvaluationClickHouseResolver,
} from "@langwatch/evaluation-server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSeedMatrix,
  deleteSeededTenantRows,
  readAnalyticsPageNumbers,
  seedMonitorPerformance,
  startMigratedClickHouse,
} from "./support/monitor-performance.fixtures.ts";

const clickHouseUrl =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-monitor-performance-${nanoid()}`;
const scoreEvaluatorId = `${tenantId}-score`;
const guardrailEvaluatorId = `${tenantId}-guardrail`;
const endMs = Date.now();
const currentStartMs = endMs - 7 * DAY_MS;
// Derived through the same service the monitors surface uses, so the window
// the trend is measured against is the one the page would have asked for.
const previousStartMs = AnalyticsComparisonWindowService.create()
  .currentVsPrevious({ startDate: currentStartMs, endDate: endMs })
  .previousPeriodStartDate.getTime();

let clickHouse: ClickHouseClient;
let queryCount = 0;

// Each test names its own budget: the package's global testTimeout is 10s,
// and these reach a real ClickHouse while sharing the machine with the rest
// of the suite.

/** The client the table reads through, counting the queries it issues. */
const countingResolver = (): EvaluationClickHouseResolver => async () => ({
  insert: (input) => clickHouse.insert(input),
  query: async (input) => {
    queryCount++;
    return clickHouse.query(input);
  },
});

const plainResolver = (): EvaluationClickHouseResolver => async () => ({
  insert: (input) => clickHouse.insert(input),
  query: (input) => clickHouse.query(input),
});

const monitors = () => [
  { id: scoreEvaluatorId, isGuardrail: false },
  { id: guardrailEvaluatorId, isGuardrail: true },
];

const readTablePerformance = (resolve: EvaluationClickHouseResolver) =>
  MonitorPerformanceAdapter.create({ resolveClickHouse: resolve }).getMonitorPerformance({
    tenantId,
    monitors: monitors(),
    previousStartMs,
    currentStartMs,
    endMs,
    timeZone: "UTC",
  });

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

describe.skipIf(!clickHouseUrl)("online evaluation monitor performance", () => {
  beforeAll(async () => {
    clickHouse = await startMigratedClickHouse();

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
    await deleteSeededTenantRows({ client: clickHouse, tenantId });
  });

  /** @scenario Performance for every monitor is read in one bounded query */
  it("loads current and previous performance with one real ClickHouse query", async () => {
    queryCount = 0;

    const performance = await readTablePerformance(countingResolver());

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
  }, 60_000);

  it("returns an explicit no-data result for a monitor without runs", async () => {
    const performance = await MonitorPerformanceAdapter.create({
      resolveClickHouse: plainResolver(),
    }).getMonitorPerformance({
      tenantId,
      monitors: [{ id: `${tenantId}-empty`, isGuardrail: false }],
      previousStartMs,
      currentStartMs,
      endMs,
      timeZone: "UTC",
    });

    expect(performance).toEqual([
      {
        monitorId: `${tenantId}-empty`,
        metric: "score",
        points: [],
        current: null,
        previous: null,
      },
    ]);
  }, 60_000);

  describe("when the analytics page reads the same period", () => {
    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same score values as the analytics page", async () => {
      const [scorePerformance] = await readTablePerformance(plainResolver());
      const analyticsPage = await readAnalyticsPageNumbers({
        client: clickHouse,
        tenantId,
        evaluatorId: scoreEvaluatorId,
        metric: "evaluations.evaluation_score",
        currentStartMs,
        endMs,
      });

      expectSameNumbers({ table: scorePerformance!, analyticsPage });
    }, 60_000);

    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same pass rate as the analytics page", async () => {
      const [, guardrailPerformance] = await readTablePerformance(plainResolver());
      const analyticsPage = await readAnalyticsPageNumbers({
        client: clickHouse,
        tenantId,
        evaluatorId: guardrailEvaluatorId,
        metric: "evaluations.evaluation_pass_rate",
        currentStartMs,
        endMs,
      });

      expectSameNumbers({ table: guardrailPerformance!, analyticsPage });
    }, 60_000);
  });
});
