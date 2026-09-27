import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AutomationApi } from "@langwatch/automation-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
/**
 * @vitest-environment node
 * What the public evaluate doors read beyond the module, composed by the real
 * installer and answered by each owner's own `*Api`.
 * @see modules/evaluation/specs/evaluation-service.feature
 */
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { EvaluatorNotFoundError, type EvaluatorApi } from "@langwatch/evaluator-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { memoryStores } from "@langwatch/process-stores";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { EVALUATION_TEST_CONFIG, installableEvaluation } from "./evaluation.fixture.ts";

const PROJECT_ID = "project-1";

const TOXICITY_MONITOR: MonitorWithEvaluator = {
  id: "monitor-1",
  projectId: PROJECT_ID,
  experimentId: null,
  evaluatorId: null,
  checkType: "azure/content_safety",
  name: "Toxicity",
  slug: "toxicity",
  executionMode: "AS_GUARDRAIL",
  enabled: false,
  preconditions: [],
  parameters: { severity: 3 },
  mappings: null,
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  evaluator: null,
};

async function boot({
  monitors = createApiFixture<MonitorApi>(),
  evaluators = createApiFixture<EvaluatorApi>(),
  modelProviders = createApiFixture<ModelProviderApi>(),
}: {
  monitors?: MonitorApi;
  evaluators?: EvaluatorApi;
  modelProviders?: ModelProviderApi;
} = {}) {
  const runtime = await createApp({ role: "api" })
    .withModules([installableEvaluation])
    .withConfig({ evaluation: EVALUATION_TEST_CONFIG })
    .withStores(memoryStores())
    .provide({
      workflow: createApiFixture<WorkflowApi>(),
      trace: createApiFixture<TraceApi>(),
      "model-provider": modelProviders,
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      evaluator: evaluators,
      monitor: monitors,
      automation: createApiFixture<AutomationApi>(),
      analytics: createApiFixture<AnalyticsApi>(),
      "data-retention": createApiFixture<DataRetentionApi>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
    })
    .boot();

  return { runtime, evaluation: runtime.service(EvaluationApi) };
}

describe("given an evaluate call names a monitor by slug", () => {
  const monitors = createApiFixture<MonitorApi>({
    findBySlug: async ({ projectId, slug }) =>
      projectId === PROJECT_ID && slug === "toxicity" ? [TOXICITY_MONITOR] : [],
  });

  describe("when the project holds that monitor", () => {
    /** @scenario "An evaluate call reads the monitor it names by slug from the monitor module" */
    it("answers the monitor the evaluate doors read", async () => {
      const { runtime, evaluation } = await boot({ monitors });

      try {
        await expect(
          evaluation.findMonitorBySlug({ projectId: PROJECT_ID, slug: "toxicity" }),
        ).resolves.toEqual({
          id: "monitor-1",
          name: "Toxicity",
          checkType: "azure/content_safety",
          parameters: { severity: 3 },
          enabled: false,
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the project holds no monitor with that slug", () => {
    /** @scenario "An evaluate call reads the monitor it names by slug from the monitor module" */
    it("answers no monitor, so the slug is read as an evaluator type", async () => {
      const { runtime, evaluation } = await boot({ monitors });

      try {
        await expect(
          evaluation.findMonitorBySlug({ projectId: PROJECT_ID, slug: "langevals/exact_match" }),
        ).resolves.toBeNull();
      } finally {
        await runtime.stop();
      }
    });
  });
});

describe("given an evaluate call names a saved evaluator", () => {
  const evaluators = createApiFixture<EvaluatorApi>({
    resolveForExecution: async ({ idOrSlug, projectId }) => {
      if (projectId !== PROJECT_ID || idOrSlug !== "my-judge") {
        throw new EvaluatorNotFoundError(idOrSlug);
      }

      return {
        evaluatorId: "evaluator-1",
        name: "My judge",
        checkType: "custom/workflow-1",
        requiredFields: ["input"],
      };
    },
  });

  describe("when the project holds it", () => {
    /** @scenario "An evaluate call resolves a saved evaluator through the evaluator module" */
    it("answers what running it needs", async () => {
      const { runtime, evaluation } = await boot({ evaluators });

      try {
        await expect(
          evaluation.resolveSavedEvaluator({ projectId: PROJECT_ID, idOrSlug: "my-judge" }),
        ).resolves.toEqual({
          checkType: "custom/workflow-1",
          settings: {},
          name: "My judge",
          evaluatorId: "evaluator-1",
          requiredFields: ["input"],
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the project does not hold it", () => {
    /** @scenario "An evaluate call resolves a saved evaluator through the evaluator module" */
    it("refuses with the evaluator module's own code", async () => {
      const { runtime, evaluation } = await boot({ evaluators });

      try {
        await expect(
          evaluation.resolveSavedEvaluator({ projectId: PROJECT_ID, idOrSlug: "absent" }),
        ).rejects.toMatchObject({ code: "evaluator_not_found" });
      } finally {
        await runtime.stop();
      }
    });
  });
});

describe("given an evaluate call reads the project's default models", () => {
  const modelProviders = createApiFixture<ModelProviderApi>({
    findResolvedDefault: async ({ featureKey }) =>
      featureKey === "evaluator.create_default"
        ? { model: "anthropic/claude-sonnet", source: "role_default", scope: "project" }
        : null,
  });

  /** @scenario "An evaluate call reads the project's default models from the cascade" */
  it("answers the cascade's model, and nothing where the cascade sets none", async () => {
    const { runtime, evaluation } = await boot({ modelProviders });

    try {
      await expect(
        evaluation.findModelForFeature({
          projectId: PROJECT_ID,
          featureKey: "evaluator.create_default",
        }),
      ).resolves.toBe("anthropic/claude-sonnet");
      await expect(
        evaluation.findModelForFeature({
          projectId: PROJECT_ID,
          featureKey: "analytics.topic_clustering_embeddings",
        }),
      ).resolves.toBeNull();
    } finally {
      await runtime.stop();
    }
  });
});

describe("given an evaluate call's evaluator reported a cost", () => {
  /** @scenario "A public evaluate call writes its cost to the ledger" */
  it("records it under the id the call chose", async () => {
    const { runtime, evaluation } = await boot();

    try {
      await expect(
        evaluation.recordEvaluationCost({
          id: "cost_1",
          projectId: PROJECT_ID,
          costType: "TRACE_CHECK",
          costName: "Toxicity",
          referenceType: "CHECK",
          referenceId: "monitor-1",
          amount: 0.01,
          currency: "USD",
          extraInfo: { trace_id: "trace-1" },
        }),
      ).resolves.toEqual({ id: "cost_1" });
    } finally {
      await runtime.stop();
    }
  });
});
