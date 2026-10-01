import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
/**
 * @vitest-environment node
 * The feature boots as a whole: the installer, its repositories and the one app
 * behind the `EvaluationApi` token, in every role a process installs it in.
 */
import { EvaluationApi, TraceNotEvaluatableError } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
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
import { describe, expect, it, vi } from "vitest";

import { evaluationServer } from "../../evaluation.server.ts";
import { EVALUATION_TEST_CONFIG, installableEvaluation } from "./evaluation.fixture.ts";

function process(
  role: "api" | "worker",
  {
    trace = createApiFixture<TraceApi>(),
    workflow = createApiFixture<WorkflowApi>({
      findEvaluatorWorkflows: async () => [],
      postStudioEvent: async ({ onEvent }) => onEvent({ type: "is_alive_response" }),
    }),
  }: { trace?: TraceApi; workflow?: WorkflowApi } = {},
) {
  return createApp({ role })
    .withModules([installableEvaluation])
    .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
    .withStores(memoryStores())
    .provide({
      workflow,
      trace,
      "model-provider": createApiFixture<ModelProviderApi>({
        getExecutionProviders: async () => ({}),
      }),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      evaluator: createApiFixture<EvaluatorApi>({ augmentResult: ({ result }) => result }),
      monitor: createApiFixture<MonitorApi>(),
      dataset: createApiFixture<DatasetApi>(),
      experiment: createApiFixture<ExperimentApi>(),
      analytics: createApiFixture<AnalyticsApi>(),
      project: createApiFixture<ProjectApi>(),
      "data-retention": createApiFixture<DataRetentionApi>({
        getPlatformDefaultRetentionDays: () => 30,
        getResolvedForProject: async () => RETAINED,
      }),
    });
}

const RETAINED = { traces: 365, scenarios: 30, experiments: 30 };

describe("given a process that installs the evaluation feature", () => {
  describe("when its pipeline is built on the worker", () => {
    /** @scenario "A module's pipeline declares each tenant's retention from data retention" */
    it("declares each tenant's retention as data retention resolves it", async () => {
      const eventing = new EventSourcing({
        enabled: false,
        processStore: InMemoryProcessStore.createForTesting(),
      });
      const runtime = await process("worker").withEventing(eventing).boot();

      try {
        const pipeline = eventing.definitions.find(
          (definition) => definition.metadata.name === "evaluation_processing",
        );

        await expect(
          pipeline?.open((definition) => definition.retentionPolicyResolver?.resolve("project-1")),
        ).resolves.toEqual(RETAINED);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when it boots", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process(role).boot();

      try {
        const app = runtime.service(EvaluationApi);

        expect(runtime.module(evaluationServer).provided).toBe(app);
        await expect(app.listCustomEvaluators({ projectId: "project-1" })).resolves.toEqual([]);
        await expect(app.warmupEvaluators({ projectId: "project-1", count: 1 })).resolves.toEqual({
          success: true,
          count: 1,
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the experiment workbench warms the evaluator runtime", () => {
    /** @scenario "An installed evaluation module warms the evaluator runtime through the studio engine" */
    it("posts one is_alive studio event per requested instance", async () => {
      const postStudioEvent = vi.fn(async () => void 0);
      const runtime = await process("api", {
        workflow: createApiFixture<WorkflowApi>({ postStudioEvent }),
      }).boot();

      try {
        await expect(
          runtime.service(EvaluationApi).warmupEvaluators({ projectId: "project-1", count: 3 }),
        ).resolves.toEqual({ success: true, count: 3 });
        expect(postStudioEvent).toHaveBeenCalledTimes(3);
        expect(postStudioEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "project-1",
            event: { type: "is_alive", payload: {} },
          }),
        );
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when a caller runs an evaluator over data it holds", () => {
    /** @scenario "An installed evaluation module runs an evaluator over data it is handed" */
    it.each(["api", "worker"] as const)(
      "answers with the evaluator's result in the %s role",
      async (role) => {
        const runtime = await process(role).boot();

        try {
          const result = await runtime.service(EvaluationApi).runEvaluator({
            projectId: "project-1",
            evaluatorType: "langevals/exact_match",
            data: { type: "default", data: { output: "yes", expected_output: "yes" } },
            settings: {},
          });

          expect(["processed", "skipped", "error"]).toContain(result.status);
        } finally {
          await runtime.stop();
        }
      },
    );
  });

  describe("when a signed-in user re-runs an evaluator on a stored trace", () => {
    /** @scenario "An installed evaluation module re-scores a stored trace through the caller's protections" */
    it("reads the trace through that user's protections", async () => {
      const viewer = { canSeeCosts: false, canSeeCapturedInput: false, canSeeCapturedOutput: true };
      const resolveViewerProtections = vi.fn(async () => viewer);
      const readTracesWithSpans = vi.fn(async () => []);
      const runtime = await process("api", {
        trace: createApiFixture<TraceApi>({ resolveViewerProtections, readTracesWithSpans }),
      }).boot();

      try {
        await expect(
          runtime.service(EvaluationApi).runTraceEvaluation(
            {
              projectId: "project-1",
              evaluatorType: "langevals/exact_match",
              traceId: "trace-1",
              settings: {},
              mappings: null,
            },
            { id: "user-1" },
          ),
        ).rejects.toBeInstanceOf(TraceNotEvaluatableError);
        expect(resolveViewerProtections).toHaveBeenCalledWith({
          projectId: "project-1",
          userId: "user-1",
        });
        expect(readTracesWithSpans).toHaveBeenCalledWith({
          projectId: "project-1",
          traceIds: ["trace-1"],
          protections: viewer,
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});
