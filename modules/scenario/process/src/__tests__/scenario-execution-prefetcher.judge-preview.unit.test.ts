/** @vitest-environment node
 * A run whose judge is LangWatch Judge (preview): the prefetch points the judge at the app's own
 * endpoint with the run's key, or refuses the run before it starts.
 * @see modules/scenario/specs/judge-preview.feature
 */
import type { Agent } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import { judgePreviewAvailabilityFixture } from "./support/judge-preview.fixture.ts";
import {
  createTestScenarioExecutionPrefetcherService,
  type ScenarioPrefetchFixture,
} from "./support/scenario-execution-prefetcher.fixture.ts";

const PROJECT_ID = "project_judge_preview";
const JUDGE_PREVIEW = "langwatch/judge-preview";

const httpAgent: Agent = {
  id: "agent_http",
  type: "http" as const,
  name: "HTTP agent",
  config: { url: "https://example.com/chat", method: "POST", headers: [] },
  projectId: PROJECT_ID,
  workflowId: null,
  copiedFromAgentId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
};

function prefetch({
  judgeModel = JUDGE_PREVIEW,
  simulatorModel = "openai/gpt-5-mini",
  isSaas = true,
  isFlagOn = true,
}: {
  judgeModel?: string;
  simulatorModel?: string;
  isSaas?: boolean;
  isFlagOn?: boolean;
} = {}) {
  const prepared: string[] = [];
  const fixture = {
    scenarioFetcher: {
      getById: async () => ({
        id: "scen_1",
        name: "Refund",
        situation: "A customer asks for a refund",
        criteria: ["The agent offers a refund"],
        labels: [],
        simulatorModel,
        judgeModel,
      }),
    },
    promptFetcher: { findByIdOrHandle: async () => null },
    agentFetcher: { findById: async () => httpAgent },
    workflowVersionFetcher: { getLatestDsl: async () => null },
    projectFetcher: { findUnique: async () => ({ apiKey: "test-platform-key" }) },
    modelParamsProvider: {
      prepare: async (_projectId: string, model: string) => {
        prepared.push(model);
        return { success: true as const, params: { model, api_key: "sk-provider" } };
      },
    },
    modelResolver: { resolve: async () => "openai/gpt-5-mini" },
    projectSecretsFetcher: { getSecrets: async () => ({}) },
    traceWaitBudgetResolver: { resolveTraceWaitTimeoutMs: async () => 1_000 },
    apiKeys: { mintRunKey: async () => "run-key-1" },
    judgePreviewAvailability: judgePreviewAvailabilityFixture({ isSaas, isFlagOn }),
  } satisfies ScenarioPrefetchFixture;
  const result = createTestScenarioExecutionPrefetcherService(fixture, {
    langwatchEndpoint: "https://app.langwatch.test",
    nlpServiceUrl: "http://langwatch_nlp:5561",
    legacyDefaultModel: "openai/gpt-5-mini",
  }).prefetch({
    context: { projectId: PROJECT_ID, scenarioId: "scen_1", setId: "set_1", batchRunId: "batch_1" },
    target: { type: "http", referenceId: httpAgent.id },
  });
  return { result, prepared };
}

describe("given a run whose judge model is LangWatch Judge (preview)", () => {
  describe("when it is prefetched on LangWatch Cloud with the flag on", () => {
    /** @scenario "A run judged by LangWatch Judge (preview) is pointed at the app's own endpoint" */
    it("points the judge at the app's judge preview address with the run's key", async () => {
      const { result, prepared } = prefetch();

      const prefetched = await result;

      expect(prefetched.success, prefetched.success ? "" : prefetched.error).toBe(true);
      if (!prefetched.success) return;
      expect(prefetched.data.judgeModelParams).toEqual({
        model: "openai/langwatch-judge-preview",
        api_base: "https://app.langwatch.test/api/judge-preview/v1",
        api_key: "run-key-1",
      });
      expect(prefetched.resolvedModels).toEqual({
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: JUDGE_PREVIEW,
      });
      expect(prepared).not.toContain(JUDGE_PREVIEW);
    });
  });

  describe("when it is prefetched where the judge may not answer", () => {
    /** @scenario "A run on LangWatch Judge (preview) is refused before it starts where it may not judge" */
    it("refuses the run on a self-hosted install, naming the model and what to pick", async () => {
      const prefetched = await prefetch({ isSaas: false }).result;

      expect(prefetched).toMatchObject({
        success: false,
        error: expect.stringMatching(
          /LangWatch Judge \(preview\) runs on LangWatch Cloud only.*Pick another judge model/,
        ),
      });
    });

    /** @scenario "A run on LangWatch Judge (preview) is refused before it starts where it may not judge" */
    it("refuses the run with the flag off for the organization", async () => {
      const prefetched = await prefetch({ isFlagOn: false }).result;

      expect(prefetched).toMatchObject({
        success: false,
        error: expect.stringMatching(/LangWatch Judge \(preview\) is not turned on/),
      });
    });
  });
});

describe("given a run whose simulator model is LangWatch Judge (preview)", () => {
  /** @scenario "LangWatch Judge (preview) cannot play another role" */
  it("refuses the run, saying the model can only be the judge", async () => {
    const prefetched = await prefetch({
      simulatorModel: JUDGE_PREVIEW,
      judgeModel: "openai/gpt-5-mini",
    }).result;

    expect(prefetched).toMatchObject({
      success: false,
      error:
        "LangWatch Judge (preview) can only be the judge of a scenario run. Pick another model for this role.",
    });
  });
});
