/**
 * @vitest-environment node
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
 * The Online Evaluations table publishes the same numbers the analytics page does, both asked
 * through the installed api. The bounded-read scenario lives in the evaluation module.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { AnalyticsApi, analyticsComparisonWindow } from "@langwatch/analytics-contract";
import { ClickHouseQueryClient, type QueryDriver } from "@langwatch/clickhouse-client";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { generate } from "@langwatch/ksuid";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootApiOverClickHouse } from "./api-analytical.fixture.ts";
import {
  buildSeedMatrix,
  deleteSeededTenantRows,
  readAnalyticsPageNumbers,
  routedQueryClient,
  seedMonitorPerformance,
  startMigratedClickHouse,
} from "./monitor-performance.fixture.ts";

const clickHouseUrl =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-monitor-performance-${generate("test").toString()}`;
const scoreEvaluatorId = `${tenantId}-score`;
const guardrailEvaluatorId = `${tenantId}-guardrail`;
const endMs = Date.now();
const currentStartMs = endMs - 7 * DAY_MS;
// The window analytics compares against, from the rule its contract publishes.
const previousStartMs = analyticsComparisonWindow({
  start: Temporal.Instant.fromEpochMilliseconds(currentStartMs),
  end: Temporal.Instant.fromEpochMilliseconds(endMs),
}).previousPeriodStart.epochMilliseconds;

let clickHouse: ClickHouseClient;
let runtime: Awaited<ReturnType<typeof bootApiOverClickHouse>>["runtime"];

const monitors = () => [
  { id: scoreEvaluatorId, isGuardrail: false },
  { id: guardrailEvaluatorId, isGuardrail: true },
];

const readTablePerformance = () =>
  runtime.service(EvaluationApi).getMonitorPerformance({
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
  analyticsPage: { current: number | null; previous: number | null; dailyValues: number[] };
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

describe("the api installed over a ClickHouse", () => {
  it("boots with evaluation on its live repositories, reading nothing until asked", async () => {
    const refusing: QueryDriver = {
      execute: () => Promise.reject(new Error("no statement is expected at boot")),
      insert: () => Promise.reject(new Error("no statement is expected at boot")),
      command: () => Promise.reject(new Error("no statement is expected at boot")),
    };
    const booted = await bootApiOverClickHouse({
      clickhouse: new ClickHouseQueryClient({ driver: refusing }),
    });

    expect(booted.runtime.service(EvaluationApi)).toBeDefined();
    expect(booted.runtime.service(AnalyticsApi)).toBeDefined();
    await booted.runtime.stop();
  }, 60_000);
});

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
    ({ runtime } = await bootApiOverClickHouse({ clickhouse: routedQueryClient(clickHouse) }));
  }, 180_000);

  afterAll(async () => {
    await runtime?.stop();
    await deleteSeededTenantRows({ client: clickHouse, tenantId });
  });

  describe("when the analytics page reads the same period", () => {
    /** @scenario The configuration table matches the analytics page numbers */
    it("reports the same score values as the analytics page", async () => {
      const [scorePerformance] = await readTablePerformance();
      const analyticsPage = await readAnalyticsPageNumbers({
        analytics: runtime.service(AnalyticsApi),
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
      const [, guardrailPerformance] = await readTablePerformance();
      const analyticsPage = await readAnalyticsPageNumbers({
        analytics: runtime.service(AnalyticsApi),
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
