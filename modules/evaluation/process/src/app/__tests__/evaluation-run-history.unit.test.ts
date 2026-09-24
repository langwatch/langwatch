import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 */
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EvaluationApi, type EvaluationRunData } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import { nowInstant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { evaluationServer } from "../../evaluation.server.ts";
import { LiveEvaluationRepositories } from "../../repositories/live/live.evaluation.repositories.ts";
import { EVALUATION_TEST_CONFIG } from "./evaluation.fixture.ts";

const TENANT = "project-1";
const TRACE = "trace-1";
const NOW = nowInstant().epochMilliseconds;
const DAY_MS = 24 * 60 * 60 * 1000;

function run(overrides: Partial<EvaluationRunData> = {}): EvaluationRunData {
  return {
    evaluationId: "evaluation-1",
    evaluatorId: "evaluator-1",
    evaluatorType: "langevals/exact_match",
    evaluatorName: "Exact match",
    traceId: TRACE,
    isGuardrail: false,
    status: "processed",
    score: 1,
    passed: true,
    label: null,
    details: null,
    inputs: { output: "hello" },
    error: null,
    errorDetails: null,
    createdAt: NOW,
    updatedAt: NOW + 100,
    LastEventOccurredAt: NOW + 100,
    archivedAt: null,
    scheduledAt: NOW,
    startedAt: NOW + 10,
    completedAt: NOW + 90,
    costId: null,
    ...overrides,
  };
}

describe("given a process that installs the evaluation module over its repositories", () => {
  describe("when a run is upserted for a trace", () => {
    /** @scenario "An installed evaluation module reads back the runs it wrote" */
    it("reads the run back by id, by trace and among the trace's evaluations", async () => {
      const runtime = await createApp({ role: "worker" })
        .withModules([withMemoryRepositories(evaluationServer)])
        .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
        .provide({
          workflow: createApiFixture<WorkflowApi>(),
          trace: createApiFixture<TraceApi>(),
          "model-provider": createApiFixture<ModelProviderApi>(),
          "feature-flag": createApiFixture<FeatureFlagApi>(),
          "data-retention": createApiFixture<DataRetentionApi>({
            getPlatformDefaultRetentionDays: () => 30,
          }),
        })
        .boot();

      try {
        const app = runtime.service(EvaluationApi);
        await app.upsertRun({ tenantId: TENANT, data: run({ status: "scheduled", updatedAt: 1 }) });
        await app.upsertRun({ tenantId: TENANT, data: run() });

        await expect(
          app.getRunByEvaluationId({ tenantId: TENANT, evaluationId: "evaluation-1" }),
        ).resolves.toEqual(run());
        await expect(app.findRunsByTraceId({ tenantId: TENANT, traceId: TRACE })).resolves.toEqual([
          run(),
        ]);
        const evaluations = await app.findTraceEvaluations({ tenantId: TENANT, traceIds: [TRACE] });
        expect(evaluations[TRACE]).toMatchObject([
          { evaluationId: "evaluation-1", status: "processed", inputs: { output: "hello" } },
        ]);
        await expect(
          app.getRunByEvaluationId({ tenantId: "project-2", evaluationId: "evaluation-1" }),
        ).rejects.toMatchObject({ code: "evaluation_not_found" });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when a run older than the platform default retention is looked up without its scheduled time", () => {
    /** @scenario "A run lookup without a scheduled time stops at the platform default retention" */
    it("refuses it as not found, reading the floor from data retention", async () => {
      const runtime = await createApp({ role: "worker" })
        .withModules([withMemoryRepositories(evaluationServer)])
        .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
        .provide({
          workflow: createApiFixture<WorkflowApi>(),
          trace: createApiFixture<TraceApi>(),
          "model-provider": createApiFixture<ModelProviderApi>(),
          "feature-flag": createApiFixture<FeatureFlagApi>(),
          "data-retention": createApiFixture<DataRetentionApi>({
            getPlatformDefaultRetentionDays: () => 30,
          }),
        })
        .boot();

      try {
        const app = runtime.service(EvaluationApi);
        const old = NOW - 31 * DAY_MS;
        await app.upsertRun({
          tenantId: TENANT,
          data: run({ scheduledAt: old, createdAt: old, startedAt: old, completedAt: old }),
        });

        await expect(
          app.getRunByEvaluationId({ tenantId: TENANT, evaluationId: "evaluation-1" }),
        ).rejects.toMatchObject({ code: "evaluation_not_found" });
      } finally {
        await runtime.stop();
      }
    });
  });
});

describe("given the live evaluation repositories over the process's ClickHouse member", () => {
  describe("when a run is looked up for a tenant", () => {
    /** @scenario "The live tier reads run history through the process's routing ClickHouse" */
    it("names the tenant on every statement and passes only the member's settings", async () => {
      const statements: { tenantId: string; settings?: Record<string, string | number> }[] = [];
      const clickhouse = createApiFixture<ProcessMembers["clickhouse"]>({
        query: async (request) => {
          statements.push({ tenantId: request.tenantId, settings: request.settings });
          return { rows: [] };
        },
      });
      const repositories = LiveEvaluationRepositories.create({
        prisma: createApiFixture<ProcessMembers["prisma"]>(),
        clickhouse,
        redis: createApiFixture<ProcessMembers["redis"]>(),
        objectStorage: createApiFixture<ProcessMembers["objectStorage"]>(),
      });

      await expect(
        repositories.runs.findByTraceId({ tenantId: TENANT, traceId: TRACE }),
      ).resolves.toEqual([]);
      await expect(
        repositories.runs.getByEvaluationId({
          tenantId: TENANT,
          evaluationId: "evaluation-1",
          retentionFloor: { getFloorMs: async () => 0 },
        }),
      ).rejects.toMatchObject({ code: "evaluation_not_found" });

      expect(statements.length).toBeGreaterThan(1);
      expect(statements.every((statement) => statement.tenantId === TENANT)).toBe(true);
    });
  });
});
