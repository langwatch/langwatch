/**
 * @vitest-environment node
 * One Evaluation service is composed when the feature installs; every read afterwards,
 * in either role, goes through it and builds nothing.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
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
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluationProcessModule } from "../../evaluation.module.ts";
import { ClickHouseEvaluationRepository } from "../../repositories/clickhouse/evaluation.repository.ts";
import { MemoryEvaluationRunRepository } from "../../repositories/memory/memory.evaluation-run.repository.ts";
import { EvaluationExecutionService } from "../../services/evaluation-execution.service.ts";
import { EVALUATION_TEST_CONFIG, installableEvaluation } from "./evaluation.fixture.ts";

const TENANT = "project-1";

const RUN: EvaluationRunData = {
  evaluationId: "evaluation-1",
  evaluatorId: "evaluator-1",
  evaluatorType: "langevals/exact_match",
  evaluatorName: "Exact match",
  traceId: "trace-1",
  isGuardrail: false,
  status: "processed",
  score: 1,
  passed: true,
  label: null,
  details: null,
  inputs: { output: "hello" },
  error: null,
  errorDetails: null,
  createdAt: 1_000,
  updatedAt: 1_100,
  LastEventOccurredAt: 1_100,
  archivedAt: null,
  scheduledAt: 1_000,
  startedAt: 1_010,
  completedAt: 1_090,
  costId: null,
};

function process(role: "api" | "worker") {
  return createApp({ role })
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
    });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given a process that composed one Evaluation service", () => {
  describe("when an API handler or a worker reads a run", () => {
    /** @scenario "API and workers share the same service" */
    it.each(["api", "worker"] as const)(
      "answers every read from that service in the %s role and builds no dependency per request",
      async (role) => {
        const runStore = vi.spyOn(MemoryEvaluationRunRepository, "create");
        const clickHouseStore = vi.spyOn(ClickHouseEvaluationRepository, "create");
        const executionEngine = vi.spyOn(EvaluationExecutionService, "create");
        const runtime = await process(role).boot();

        try {
          const app = runtime.service(EvaluationApi);
          const builtAtBoot = {
            runs: runStore.mock.calls.length,
            clickHouse: clickHouseStore.mock.calls.length,
            execution: executionEngine.mock.calls.length,
          };

          await app.upsertRun({ tenantId: TENANT, data: RUN });
          for (const _read of [1, 2, 3]) {
            await expect(
              app.getRunByEvaluationId({ tenantId: TENANT, evaluationId: "evaluation-1" }),
            ).resolves.toEqual(RUN);
            expect(runtime.service(EvaluationApi)).toBe(app);
          }

          expect(builtAtBoot.runs).toBe(1);
          expect(runtime.module(evaluationProcessModule).provided).toBe(app);
          expect(runStore).toHaveBeenCalledTimes(builtAtBoot.runs);
          expect(clickHouseStore).toHaveBeenCalledTimes(builtAtBoot.clickHouse);
          expect(executionEngine).toHaveBeenCalledTimes(builtAtBoot.execution);
        } finally {
          await runtime.stop();
        }
      },
    );
  });
});
