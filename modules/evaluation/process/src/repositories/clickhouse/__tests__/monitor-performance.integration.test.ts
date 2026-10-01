/**
 * @vitest-environment node
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
 * The Online Evaluations table loads every monitor's trend in one bounded ClickHouse read.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { analyticsComparisonWindow } from "@langwatch/analytics-contract";
import { ClickHouseQueryClient, type QueryDriver } from "@langwatch/clickhouse-client";
import { generate } from "@langwatch/ksuid";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildSeedMatrix,
  deleteSeededTenantRows,
  seedMonitorPerformance,
  startMigratedClickHouse,
} from "../../../__tests__/support/monitor-performance.fixtures.ts";
import { MonitorPerformanceService } from "../../../services/monitor-performance.service.ts";
import { ClickHouseEvaluationSession } from "../clickhouse.evaluation-session.store.ts";
import { ClickHouseMonitorPerformanceRepository } from "../monitor-performance.repository.ts";

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
let service: MonitorPerformanceService;
let queryCount = 0;

/** The routed ClickHouse member over the migrated test server, counting its reads. */
function countingQueryClient(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      queryCount++;
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      await client.insert({
        table: request.table,
        values: request.rows,
        format: "JSONEachRow",
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
    async command(request) {
      await client.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
  return new ClickHouseQueryClient({ driver });
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
    const routed = countingQueryClient(clickHouse);
    service = MonitorPerformanceService.create({
      repository: ClickHouseMonitorPerformanceRepository.create({
        resolveClient: (tenant) => Promise.resolve(new ClickHouseEvaluationSession(routed, tenant)),
      }),
    });
  }, 180_000);

  afterAll(async () => {
    await deleteSeededTenantRows({ client: clickHouse, tenantId });
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
