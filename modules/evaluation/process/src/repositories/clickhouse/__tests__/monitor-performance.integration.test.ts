/**
 * @vitest-environment node
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
 * The Online Evaluations table loads every monitor's trend in one bounded ClickHouse read.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { analyticsComparisonWindow } from "@langwatch/analytics-contract";
import type { QueryDriver } from "@langwatch/clickhouse-client";
import { generate } from "@langwatch/ksuid";
import {
  type TestAppReader,
  provisionTestAppReader,
  migrateAppReaderEndpoint,
  startAppReaderEndpoint,
} from "@langwatch/test-harness/clickhouse-app-reader";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildSeedMatrix,
  deleteSeededTenantRows,
  seedMonitorPerformance,
} from "../../../__tests__/support/monitor-performance.fixtures.ts";
import { MonitorPerformanceService } from "../../../features/monitors/services/monitor-performance.service.ts";
import { ClickHouseMonitorPerformanceRepository } from "../monitor-performance.repository.ts";

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
let appReader: TestAppReader;
let service: MonitorPerformanceService;
let queryCount = 0;

/** The app reader's driver, counting the reads the process sends through it. */
function countingReads(driver: QueryDriver): QueryDriver {
  return {
    ...driver,
    execute(request) {
      queryCount++;
      return driver.execute(request);
    },
  };
}

const readPerformance = (monitors: { id: string; isGuardrail: boolean }[]) =>
  service.getMonitorPerformance({
    tenantId,
    monitors,
    previousStartMs,
    currentStartMs,
    endMs,
    timeZone: "UTC",
  });

describe("online evaluation monitor performance", () => {
  beforeAll(async () => {
    const endpoint = await startAppReaderEndpoint({
      environment: process.env,
      suite: "evaluation-monitor-performance-reader",
    });
    await migrateAppReaderEndpoint({ endpoint });
    appReader = await provisionTestAppReader({
      endpoint,
      environment: process.env,
      wrapReaderDriver: countingReads,
    });
    clickHouse = appReader.admin;
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
    service = MonitorPerformanceService.create({
      repository: ClickHouseMonitorPerformanceRepository.create({
        resolveQueryClient: async () => appReader.worker,
      }),
    });
  }, 180_000);

  afterAll(async () => {
    await deleteSeededTenantRows({ client: clickHouse, tenantId });
    await appReader?.close();
  });

  /** @scenario Performance for every monitor is read in one bounded query */
  it("loads current and previous performance with one real ClickHouse query", async () => {
    queryCount = 0;

    const performance = await readPerformance([
      { id: scoreEvaluatorId, isGuardrail: false },
      { id: guardrailEvaluatorId, isGuardrail: true },
    ]);

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
    const performance = await readPerformance([{ id: `${tenantId}-empty`, isGuardrail: false }]);

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
});
