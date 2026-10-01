import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 */
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { EvaluationApi, type EvaluationRunData } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { LiveEvaluationRepositories } from "../../repositories/live/live.evaluation.repositories.ts";
import { EvaluationRetentionDaysService } from "../../services/evaluation-retention-days.service.ts";
import { EVALUATION_TEST_CONFIG, installableEvaluation } from "./evaluation.fixture.ts";

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
        .withModules([installableEvaluation])
        .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
        .withStores(memoryStores())
        .provide({
          workflow: createApiFixture<WorkflowApi>(),
          trace: createApiFixture<TraceApi>(),
          "model-provider": createApiFixture<ModelProviderApi>(),
          "feature-flag": createApiFixture<FeatureFlagApi>(),
          evaluator: createApiFixture<EvaluatorApi>(),
          monitor: createApiFixture<MonitorApi>(),
          dataset: createApiFixture<DatasetApi>(),
          experiment: createApiFixture<ExperimentApi>(),
          analytics: createApiFixture<AnalyticsApi>(),
          project: createApiFixture<ProjectApi>(),
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
          retention: EvaluationRetentionDaysService.create(
            createApiFixture<DataRetentionApi>({
              getPlatformDefaultRetentionDays: () => 30,
              getRetentionDays: async () => 30,
            }),
          ),
        }),
      ).rejects.toMatchObject({ code: "evaluation_not_found" });

      expect(statements.length).toBeGreaterThan(1);
      expect(statements.every((statement) => statement.tenantId === TENANT)).toBe(true);
    });
  });
});

describe("given the live run read over a tenant's retention from data retention", () => {
  /** The fallback probe's lower bound, after the recent-window probe misses. */
  async function fallbackFloorMs(retention: Pick<DataRetentionApi, "getRetentionDays">) {
    const probes: number[] = [];
    const repositories = LiveEvaluationRepositories.create({
      prisma: createApiFixture<ProcessMembers["prisma"]>(),
      clickhouse: createApiFixture<ProcessMembers["clickhouse"]>({
        query: async (request) => {
          const sinceMs = request.params?.sinceMs;
          if (typeof sinceMs === "number") probes.push(sinceMs);
          return { rows: [] };
        },
      }),
      redis: createApiFixture<ProcessMembers["redis"]>(),
      objectStorage: createApiFixture<ProcessMembers["objectStorage"]>(),
    });
    const before = nowInstant().epochMilliseconds;
    await expect(
      repositories.runs.getByEvaluationId({
        tenantId: TENANT,
        evaluationId: "evaluation-1",
        retention: EvaluationRetentionDaysService.create(
          createApiFixture<DataRetentionApi>({
            getPlatformDefaultRetentionDays: () => 30,
            getRetentionDays: retention.getRetentionDays,
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "evaluation_not_found" });
    return { before, floorMs: probes.at(-1) };
  }

  describe("when a run is looked up without its scheduled time", () => {
    /** @scenario "A run lookup without a scheduled time stops at the tenant's retention horizon" */
    it("floors the scan at the tenant's retention plus two days' margin", async () => {
      const { before, floorMs } = await fallbackFloorMs({ getRetentionDays: async () => 90 });

      expect(floorMs).toBeLessThanOrEqual(before - 92 * DAY_MS + 1_000);
      expect(floorMs).toBeGreaterThan(before - 93 * DAY_MS);
    });

    /** @scenario "A run lookup whose tenant retention cannot be read stops at the platform default" */
    it("floors the scan at the platform default when data retention refuses", async () => {
      const { before, floorMs } = await fallbackFloorMs({
        getRetentionDays: async () => {
          throw new Error("retention store unavailable");
        },
      });

      expect(floorMs).toBeLessThanOrEqual(before - 32 * DAY_MS + 1_000);
      expect(floorMs).toBeGreaterThan(before - 33 * DAY_MS);
    });
  });
});
