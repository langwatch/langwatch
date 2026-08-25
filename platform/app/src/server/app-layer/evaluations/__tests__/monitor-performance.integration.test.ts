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
import type { EvaluationService } from "@langwatch/evaluation-contract";
import {
  EvaluationAdapter,
  EvaluationExecutionPort,
  EvaluationRetentionFloorPort,
} from "@langwatch/evaluation-server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteEvaluationRunsByTenant } from "~/server/analytics/clickhouse/__tests__/test-utils/clickhouse-cleanup";
import { currentVsPreviousDates } from "~/server/api/routers/analytics/common";
import {
  cleanupTestData,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { createTestApp } from "~/server/app-layer/presets";
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

class NullEvaluationExecution extends EvaluationExecutionPort {
  async execute(): Promise<{ status: "skipped" }> {
    return { status: "skipped" };
  }
}

class FixedEvaluationRetentionFloor extends EvaluationRetentionFloorPort {
  async getFloorMs(): Promise<number> {
    return 0;
  }
}

function createEvaluations(client: ClickHouseClient): EvaluationService {
  return EvaluationAdapter.create({
    resolveClickHouse: async () => ({
      insert: (input) => client.insert(input as never),
      query: async (input) => {
        const result = await client.query(input as never);
        return {
          json: async <Result>() =>
            (await result.json<Result>()) as unknown as Result[],
        };
      },
    }),
    retentionFloor: new FixedEvaluationRetentionFloor(),
    execution: new NullEvaluationExecution(),
    workflows: createTestApp().workflows,
  });
}

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
  return createEvaluations(clickHouse).getMonitorPerformance({
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
    const performance = await createEvaluations(
      countingClient(),
    ).getMonitorPerformance({
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
    const [empty] = await createEvaluations(clickHouse).getMonitorPerformance({
      tenantId,
      monitors: [{ id: `${tenantId}-empty`, isGuardrail: false }],
      previousStartMs,
      currentStartMs,
      endMs,
      timeZone: "UTC",
    });

    expect(empty).toEqual({
      monitorId: `${tenantId}-empty`,
      metric: "score",
      points: [],
      current: null,
      previous: null,
    });
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

      expectSameNumbers({ table: scorePerformance!, analyticsPage });
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

      expectSameNumbers({ table: guardrailPerformance!, analyticsPage });
    });
  });
});
