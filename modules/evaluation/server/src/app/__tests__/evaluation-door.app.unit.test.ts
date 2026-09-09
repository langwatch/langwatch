/**
 * @vitest-environment node
 * What the `evaluations.*` door answers: the evaluator inventory, one re-score
 * and its report, and the warm-up.
 */
import type { EvaluationRunOutcome } from "@langwatch/evaluation-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  createEvaluationTestApp,
  TestEvaluationCustomEvaluators,
  TestEvaluationInstallEnvironment,
  TestEvaluationRescore,
  TestEvaluationReport,
  TestEvaluationRunAnalytics,
  TestEvaluationWarmup,
} from "./evaluation.fixture.ts";

const PROJECT_ID = "proj-byok-1";
const USER_ID = "user-test";
const AZURE_ENV = ["AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"];

const PROCESSED_RESULT = {
  status: "processed",
  score: 0.75,
  passed: true,
  label: "ok",
  details: "looks fine",
} as EvaluationRunOutcome;

/** A model-provider peer that answers one project's execution providers. */
function modelProviders(providers: Record<string, unknown> = {}): ModelProviderApi {
  return createApiFixture<ModelProviderApi>({
    getExecutionProviders: async () => providers as never,
  });
}

const configuredAzure = {
  azure_safety: {
    enabled: true,
    customKeys: {
      AZURE_CONTENT_SAFETY_ENDPOINT: "https://byok.cognitiveservices.azure.com/",
      AZURE_CONTENT_SAFETY_KEY: "byok-key",
    },
  },
};

describe("given the project has no azure_safety provider", () => {
  const app = (environment: Record<string, string | undefined> = {}) =>
    createEvaluationTestApp({
      infrastructure: { environment: new TestEvaluationInstallEnvironment(environment) },
      dependencies: { modelProviders: modelProviders() },
    });

  describe("when the client lists the evaluators", () => {
    /** @scenario "The evaluator inventory names what this install and this project lack" */
    it("marks every Azure evaluator with both missing credentials", async () => {
      const catalogue = await app().listEvaluators({ projectId: PROJECT_ID });

      expect(catalogue["azure/content_safety"]?.missingEnvVars).toEqual(AZURE_ENV);
      expect(catalogue["azure/prompt_injection"]?.missingEnvVars).toEqual(AZURE_ENV);
      expect(catalogue["azure/jailbreak"]?.missingEnvVars).toEqual(AZURE_ENV);
    });

    it("ignores the install environment for Azure evaluators", async () => {
      const catalogue = await app({
        AZURE_CONTENT_SAFETY_ENDPOINT: "https://shared.example.com/",
        AZURE_CONTENT_SAFETY_KEY: "shared-key",
      }).listEvaluators({ projectId: PROJECT_ID });

      expect(catalogue["azure/content_safety"]?.missingEnvVars).toEqual(AZURE_ENV);
    });

    it("still reads every other evaluator's variables from the install environment", async () => {
      const catalogue = await app({ OPENAI_API_KEY: "sk-test" }).listEvaluators({
        projectId: PROJECT_ID,
      });

      expect(catalogue["openai/moderation"]?.missingEnvVars).toEqual([]);
    });

    it("resolves the project's providers once, for the project the caller named", async () => {
      const calls: { projectId: string }[] = [];
      const peers = createApiFixture<ModelProviderApi>({
        getExecutionProviders: async (input) => {
          calls.push({ projectId: input.projectId });

          return {};
        },
      });

      await createEvaluationTestApp({ dependencies: { modelProviders: peers } }).listEvaluators({
        projectId: PROJECT_ID,
      });

      expect(calls).toEqual([{ projectId: PROJECT_ID }]);
    });
  });
});

describe("given the project has azure_safety configured", () => {
  describe("when the client lists the evaluators", () => {
    it("marks every Azure evaluator as needing nothing", async () => {
      const catalogue = await createEvaluationTestApp({
        dependencies: { modelProviders: modelProviders(configuredAzure) },
      }).listEvaluators({ projectId: PROJECT_ID });

      expect(catalogue["azure/content_safety"]?.missingEnvVars).toEqual([]);
      expect(catalogue["azure/prompt_injection"]?.missingEnvVars).toEqual([]);
      expect(catalogue["azure/jailbreak"]?.missingEnvVars).toEqual([]);
    });
  });
});

describe("given an evaluator this install left out", () => {
  describe("when the client lists the evaluators", () => {
    /** @scenario "The evaluator inventory names what this install and this project lack" */
    it("says so, separately from it being unconfigured", async () => {
      const catalogue = await createEvaluationTestApp({
        infrastructure: {
          environment: new TestEvaluationInstallEnvironment({ LANGWATCH_ENABLE_PRESIDIO: "false" }),
        },
      }).listEvaluators({ projectId: PROJECT_ID });

      expect(catalogue["presidio/pii_detection"]?.unavailable).toMatchObject({
        reason: "PII detection is not installed on this server.",
      });
      expect(catalogue["openai/moderation"]?.unavailable).toBeUndefined();
    });
  });
});

describe("when the client asks for the project's custom evaluators", () => {
  it("hands back what the process resolved, for that project", async () => {
    const customEvaluators = new TestEvaluationCustomEvaluators([
      { id: "workflow_1", name: "Tone", versions: [] },
    ]);

    const listed = await createEvaluationTestApp({
      infrastructure: { customEvaluators },
    }).listCustomEvaluators({ projectId: PROJECT_ID });

    expect(listed).toEqual([{ id: "workflow_1", name: "Tone", versions: [] }]);
    expect(customEvaluators.calls).toEqual([{ projectId: PROJECT_ID }]);
  });
});

describe("given one trace is re-evaluated", () => {
  const runInput = {
    projectId: PROJECT_ID,
    evaluatorType: "langevals/basic" as const,
    traceId: "trace_1",
    settings: {},
    mappings: { mapping: {}, expansions: [] },
  };

  describe("when the evaluator answers", () => {
    it("returns the evaluator's result to the caller", async () => {
      const app = createEvaluationTestApp({
        infrastructure: { rescore: new TestEvaluationRescore(PROCESSED_RESULT) },
      });

      await expect(app.runTraceEvaluation(runInput, { id: USER_ID })).resolves.toEqual(
        PROCESSED_RESULT,
      );
    });

    /**
     * @scenario "A re-scored trace is reported onto the pipeline every other verdict travels on"
     */
    it("reports the run onto the pipeline against the project's tenant", async () => {
      const report = new TestEvaluationReport();
      const app = createEvaluationTestApp({
        infrastructure: { rescore: new TestEvaluationRescore(PROCESSED_RESULT), report },
      });

      await app.runTraceEvaluation(runInput, { id: USER_ID });

      expect(report.reported).toHaveLength(1);
      expect(report.reported[0]).toMatchObject({
        tenantId: PROJECT_ID,
        evaluatorId: "langevals/basic",
        evaluatorType: "langevals/basic",
        traceId: "trace_1",
        status: "processed",
        score: 0.75,
        passed: true,
        label: "ok",
        details: "looks fine",
      });
    });

    it("attributes the run to the caller", async () => {
      const analytics = new TestEvaluationRunAnalytics();
      const app = createEvaluationTestApp({
        infrastructure: { rescore: new TestEvaluationRescore(PROCESSED_RESULT), analytics },
      });

      await app.runTraceEvaluation(runInput, { id: USER_ID });

      expect(analytics.runs).toEqual([{ userId: USER_ID, projectId: PROJECT_ID }]);
    });
  });

  describe("when the pipeline dispatch fails", () => {
    /**
     * @scenario "A re-scored trace is reported onto the pipeline every other verdict travels on"
     */
    it("still answers the caller", async () => {
      const app = createEvaluationTestApp({
        infrastructure: {
          rescore: new TestEvaluationRescore(PROCESSED_RESULT),
          report: new TestEvaluationReport(true),
        },
      });

      await expect(app.runTraceEvaluation(runInput, { id: USER_ID })).resolves.toEqual(
        PROCESSED_RESULT,
      );
    });
  });
});

describe("given the client warms the evaluator runtime", () => {
  describe("when every probe answers", () => {
    it("sends one probe per requested instance and reports the count", async () => {
      const warmup = new TestEvaluationWarmup();
      const app = createEvaluationTestApp({ infrastructure: { warmup } });

      await expect(app.warmupEvaluators({ projectId: PROJECT_ID, count: 3 })).resolves.toEqual({
        success: true,
        count: 3,
      });
      expect(warmup.probes).toHaveLength(3);
    });
  });

  describe("when every probe fails", () => {
    /** @scenario "A warm-up is a nudge rather than a health check" */
    it("succeeds anyway — a warm-up is not a health check", async () => {
      const app = createEvaluationTestApp({
        infrastructure: { warmup: new TestEvaluationWarmup(true) },
      });

      await expect(app.warmupEvaluators({ projectId: PROJECT_ID, count: 2 })).resolves.toEqual({
        success: true,
        count: 2,
      });
    });
  });
});
