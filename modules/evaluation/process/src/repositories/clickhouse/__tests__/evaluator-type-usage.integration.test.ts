/**
 * @vitest-environment node
 * @see modules/evaluation/specs/evaluator-platform-usage.feature
 * Staff ops counts of evaluator usage per type across every tenant, over the migrated schema.
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
const suffix = generate("test").toString();
const firstProjectId = `test-type-usage-${suffix}`;
const secondProjectId = `test-type-usage-second-${suffix}`;
/** A type no other suite writes, so the platform-wide answer is read for this suite's rows. */
const evaluatorType = `test/type-usage-${suffix}`;
const until = Date.now();
const since = until - 24 * HOUR_MS;

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
  EvaluatorId: `${run.tenantId}-monitor`,
  EvaluatorType: evaluatorType,
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

async function usageOfSuiteType() {
  const usage = await service.countEvaluatorUsageByType({ since, until });
  return usage.find((row) => row.evaluatorType === evaluatorType);
}

describe.skipIf(!clickHouseUrl)("evaluator usage by type across the platform", () => {
  beforeAll(async () => {
    clickHouse = await startMigratedClickHouse();
    const retriedEvaluationId = `retried-${generate("test").toString()}`;
    const runs: SeededRun[] = [
      { tenantId: firstProjectId, status: "processed", scheduledAt: since + HOUR_MS },
      {
        tenantId: firstProjectId,
        status: "error",
        scheduledAt: since + 2 * HOUR_MS,
        error: "Request timed out while judging 'the customer said their card is 4111'",
      },
      { tenantId: firstProjectId, status: "skipped", scheduledAt: since + 3 * HOUR_MS },
      { tenantId: firstProjectId, status: "error", scheduledAt: since - HOUR_MS },
      {
        tenantId: secondProjectId,
        status: "error",
        error: "rate limit",
        scheduledAt: since + HOUR_MS,
      },
      {
        tenantId: secondProjectId,
        status: "error",
        error: "Service Unavailable (503)",
        evaluationId: retriedEvaluationId,
        scheduledAt: since + 5 * HOUR_MS,
      },
      {
        tenantId: secondProjectId,
        status: "processed",
        evaluationId: retriedEvaluationId,
        scheduledAt: since + 5 * HOUR_MS,
        updatedAt: since + 6 * HOUR_MS,
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
    await deleteSeededTenantRows({ client: clickHouse, tenantId: firstProjectId });
    await deleteSeededTenantRows({ client: clickHouse, tenantId: secondProjectId });
  });

  /** @scenario "Each evaluator type is counted across every project" */
  /** @scenario "A revised run counts once by its latest revision" */
  /** @scenario "Runs outside the range are not counted in the platform usage" */
  it("counts each type's projects, runs, errors by code and skipped runs", async () => {
    const usage = await usageOfSuiteType();

    expect(usage).toEqual({
      evaluatorType,
      projects: 2,
      runs: 5,
      errors: 2,
      skipped: 1,
      errorsByCode: [
        { code: "rate_limited", count: 1 },
        { code: "timeout", count: 1 },
      ],
    });
    expect(JSON.stringify(usage)).not.toContain("4111");
    expect(JSON.stringify(usage)).not.toContain("Secret evaluator name");
  });
});
