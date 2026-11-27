/**
 * @vitest-environment node
 * @see modules/evaluation/specs/evaluator-outcome-counts.feature
 * Staff ops counts of online evaluator runs over the migrated ClickHouse schema.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteSeededTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/support/monitor-performance.fixtures.ts";
import { EvaluatorOutcomeService } from "../../../features/monitors/services/evaluator-outcome.service.ts";
import { ClickHouseEvaluationSession } from "../clickhouse.evaluation-session.store.ts";
import { ClickHouseMonitorPerformanceRepository } from "../monitor-performance.repository.ts";

const clickHouseUrl =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;

const HOUR_MS = 60 * 60 * 1000;
const projectId = `test-outcomes-${generate("test").toString()}`;
const otherProjectId = `test-outcomes-other-${generate("test").toString()}`;
const evaluatorId = `${projectId}-monitor`;
const retriedEvaluatorId = `${projectId}-retried`;
const otherEvaluatorId = `${otherProjectId}-monitor`;
const until = Date.now();
const since = until - 24 * HOUR_MS;
const lastErrorAt = since + 3 * HOUR_MS;

let clickHouse: ClickHouseClient;
let service: EvaluatorOutcomeService;

function routedQueryClient(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert() {
      throw new Error("this suite seeds through the raw client");
    },
    async command() {
      throw new Error("this suite seeds through the raw client");
    },
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

type SeededRun = {
  tenantId: string;
  evaluatorId: string;
  status: string;
  scheduledAt: number;
  error?: string;
  evaluationId?: string;
  updatedAt?: number;
};

const runRow = (run: SeededRun) => ({
  ProjectionId: `projection-${generate("test").toString()}`,
  TenantId: run.tenantId,
  EvaluationId: run.evaluationId ?? `eval-${generate("test").toString()}`,
  Version: "1",
  EvaluatorId: run.evaluatorId,
  EvaluatorType: "langevals/llm_boolean",
  EvaluatorName: "Secret evaluator name",
  TraceId: `trace-${generate("test").toString()}`,
  Status: run.status,
  Score: null,
  Passed: null,
  Label: null,
  Error: run.error ?? null,
  ScheduledAt: new Date(run.scheduledAt),
  UpdatedAt: new Date(run.updatedAt ?? run.scheduledAt),
  CompletedAt: new Date(run.updatedAt ?? run.scheduledAt),
  LastProcessedEventId: `event-${generate("test").toString()}`,
});

describe.skipIf(!clickHouseUrl)("evaluator outcome counts", () => {
  beforeAll(async () => {
    clickHouse = await startMigratedClickHouse();
    const retriedEvaluationId = `retried-${generate("test").toString()}`;
    const runs: SeededRun[] = [
      { tenantId: projectId, evaluatorId, status: "processed", scheduledAt: since + HOUR_MS },
      {
        tenantId: projectId,
        evaluatorId,
        status: "error",
        scheduledAt: lastErrorAt,
        error: "Request timed out while judging 'the customer said their card is 4111'",
      },
      { tenantId: projectId, evaluatorId, status: "skipped", scheduledAt: since + 4 * HOUR_MS },
      { tenantId: projectId, evaluatorId, status: "error", scheduledAt: since - HOUR_MS },
      {
        tenantId: projectId,
        evaluatorId: retriedEvaluatorId,
        status: "error",
        error: "Service Unavailable (503)",
        evaluationId: retriedEvaluationId,
        scheduledAt: since + 5 * HOUR_MS,
      },
      {
        tenantId: projectId,
        evaluatorId: retriedEvaluatorId,
        status: "processed",
        evaluationId: retriedEvaluationId,
        scheduledAt: since + 5 * HOUR_MS,
        updatedAt: since + 6 * HOUR_MS,
      },
      {
        tenantId: otherProjectId,
        evaluatorId: otherEvaluatorId,
        status: "error",
        error: "rate limit",
        scheduledAt: since + HOUR_MS,
      },
    ];
    await clickHouse.insert({
      table: "evaluation_runs",
      values: runs.map(runRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    const routed = routedQueryClient(clickHouse);
    service = EvaluatorOutcomeService.create({
      repository: ClickHouseMonitorPerformanceRepository.create({
        resolveClient: (tenant) => Promise.resolve(new ClickHouseEvaluationSession(routed, tenant)),
      }),
    });
  }, 180_000);

  afterAll(async () => {
    await deleteSeededTenantRows({ client: clickHouse, tenantId: projectId });
    await deleteSeededTenantRows({ client: clickHouse, tenantId: otherProjectId });
  });

  /** @scenario "Runs of each evaluator are counted with their errors by code" */
  /** @scenario "Runs outside the range are not counted" */
  it("counts each evaluator's runs, errors by code and last error time", async () => {
    const counts = await service.countEvaluatorOutcomes({ projectIds: [projectId], since, until });

    expect(counts.find((count) => count.evaluatorId === evaluatorId)).toEqual({
      projectId,
      evaluatorId,
      evaluatorType: "langevals/llm_boolean",
      runs: 3,
      errors: 1,
      skipped: 1,
      errorsByCode: [{ code: "timeout", count: 1 }],
      lastErrorAt,
    });
    expect(JSON.stringify(counts)).not.toContain("4111");
    expect(JSON.stringify(counts)).not.toContain("Secret evaluator name");
  });

  /** @scenario "Only the latest revision of a run is counted" */
  it("counts a retried run once, by its latest revision", async () => {
    const counts = await service.countEvaluatorOutcomes({ projectIds: [projectId], since, until });

    expect(counts.find((count) => count.evaluatorId === retriedEvaluatorId)).toEqual({
      projectId,
      evaluatorId: retriedEvaluatorId,
      evaluatorType: "langevals/llm_boolean",
      runs: 1,
      errors: 0,
      skipped: 0,
      errorsByCode: [],
      lastErrorAt: null,
    });
  });

  /** @scenario "Another project's runs are never counted" */
  it("reads only the projects it is asked for", async () => {
    const counts = await service.countEvaluatorOutcomes({ projectIds: [projectId], since, until });
    expect(counts.map((count) => count.projectId)).not.toContain(otherProjectId);

    const both = await service.countEvaluatorOutcomes({
      projectIds: [projectId, otherProjectId],
      since,
      until,
    });
    expect(both.find((count) => count.projectId === otherProjectId)).toMatchObject({
      evaluatorId: otherEvaluatorId,
      errorsByCode: [{ code: "rate_limited", count: 1 }],
    });
  });
});
