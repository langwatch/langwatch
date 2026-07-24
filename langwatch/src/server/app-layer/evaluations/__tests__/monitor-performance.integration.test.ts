/**
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteEvaluationRunsByTenant } from "~/server/analytics/clickhouse/__tests__/test-utils/clickhouse-cleanup";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { summarizeMonitorPerformance } from "../monitor-performance.service";
import { MonitorPerformanceClickHouseRepository } from "../repositories/monitor-performance.clickhouse.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-monitor-performance-${nanoid()}`;
const scoreEvaluatorId = `${tenantId}-score`;
const guardrailEvaluatorId = `${tenantId}-guardrail`;
const currentStartMs = Date.now() - 7 * DAY_MS;
const previousStartMs = currentStartMs - 7 * DAY_MS;
const endMs = currentStartMs + 7 * DAY_MS;

let clickHouse: ClickHouseClient;
let queryCount = 0;

const evaluationRun = ({
  evaluationId = `eval-${nanoid()}`,
  evaluatorId,
  scheduledAtMs,
  score,
  passed,
  status = "processed",
  updatedAtMs = scheduledAtMs,
}: {
  evaluationId?: string;
  evaluatorId: string;
  scheduledAtMs: number;
  score: number | null;
  passed: number | null;
  status?: string;
  updatedAtMs?: number;
}) => ({
  ProjectionId: `projection-${nanoid()}`,
  TenantId: tenantId,
  EvaluationId: evaluationId,
  Version: "1",
  EvaluatorId: evaluatorId,
  EvaluatorType: "langevals/test",
  TraceId: `trace-${nanoid()}`,
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

beforeAll(async () => {
  const containers = await startTestContainers();
  clickHouse = containers.clickHouseClient;

  const correctedEvaluationId = `corrected-${nanoid()}`;
  const rows = [
    evaluationRun({
      evaluatorId: scoreEvaluatorId,
      scheduledAtMs: currentStartMs + DAY_MS,
      score: 0.2,
      passed: 0,
    }),
    evaluationRun({
      evaluatorId: scoreEvaluatorId,
      scheduledAtMs: currentStartMs + DAY_MS,
      score: 0.8,
      passed: 1,
    }),
    evaluationRun({
      evaluatorId: scoreEvaluatorId,
      scheduledAtMs: currentStartMs + 2 * DAY_MS,
      score: 1,
      passed: 1,
    }),
    evaluationRun({
      evaluatorId: scoreEvaluatorId,
      scheduledAtMs: currentStartMs - DAY_MS,
      score: 0.4,
      passed: 0,
    }),
    evaluationRun({
      evaluationId: correctedEvaluationId,
      evaluatorId: scoreEvaluatorId,
      scheduledAtMs: currentStartMs + 3 * DAY_MS,
      score: 0.1,
      passed: 0,
    }),
    evaluationRun({
      evaluationId: correctedEvaluationId,
      evaluatorId: scoreEvaluatorId,
      scheduledAtMs: currentStartMs + 3 * DAY_MS,
      score: 0.9,
      passed: 1,
      updatedAtMs: currentStartMs + 3 * DAY_MS + 1_000,
    }),
    evaluationRun({
      evaluatorId: guardrailEvaluatorId,
      scheduledAtMs: currentStartMs + DAY_MS,
      score: null,
      passed: 1,
    }),
    evaluationRun({
      evaluatorId: guardrailEvaluatorId,
      scheduledAtMs: currentStartMs + DAY_MS,
      score: null,
      passed: 0,
    }),
    evaluationRun({
      evaluatorId: guardrailEvaluatorId,
      scheduledAtMs: currentStartMs - DAY_MS,
      score: null,
      passed: 1,
    }),
    evaluationRun({
      evaluatorId: guardrailEvaluatorId,
      scheduledAtMs: currentStartMs + 2 * DAY_MS,
      score: null,
      passed: null,
      status: "error",
    }),
    evaluationRun({
      evaluatorId: scoreEvaluatorId,
      scheduledAtMs: previousStartMs - DAY_MS,
      score: 0,
      passed: 0,
    }),
  ];

  await clickHouse.insert({
    table: "evaluation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 180_000);

afterAll(async () => {
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

    const buckets = await repository.findBuckets({
      tenantId,
      evaluatorIds: [scoreEvaluatorId, guardrailEvaluatorId],
      previousStartMs,
      currentStartMs,
      endMs,
      timeZone: "UTC",
    });
    const performance = summarizeMonitorPerformance(
      [
        { id: scoreEvaluatorId, isGuardrail: false },
        { id: guardrailEvaluatorId, isGuardrail: true },
      ],
      buckets,
    );

    expect(queryCount).toBe(1);
    expect(performance).toEqual([
      {
        monitorId: scoreEvaluatorId,
        metric: "score",
        points: [0.5, 1, 0.9],
        current: 0.725,
        previous: 0.4,
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
      summarizeMonitorPerformance(
        [{ id: `${tenantId}-empty`, isGuardrail: false }],
        buckets,
      ),
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
});
