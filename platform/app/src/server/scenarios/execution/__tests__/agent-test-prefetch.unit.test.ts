/**
 * @vitest-environment node
 *
 * The prefetch of an agent test run: the fixed scenario, the script, the
 * agent's adapter data, and no model at all.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { describe, expect, it, vi } from "vitest";
import { AGENT_TEST_SCENARIO_ID } from "../../agent-test-scenario";
import {
  type DataPrefetcherDependencies,
  prefetchScenarioData,
} from "../data-prefetcher";

vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_NLP_SERVICE: "http://langwatch_nlp:5561",
    LANGWATCH_ENDPOINT: "http://app:5560",
    CREDENTIALS_SECRET: "11".repeat(32),
  },
}));

const httpAgent = {
  id: "agent_http",
  name: "ACME Support Agent",
  type: "http" as const,
  config: {
    name: "ACME Support Agent",
    url: "https://acme.example/chat",
    method: "POST",
    headers: [],
    bodyTemplate: '{"input": "{{input}}"}',
    outputPath: "$.output",
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  },
};

function deps(
  overrides: Partial<DataPrefetcherDependencies> = {},
): DataPrefetcherDependencies {
  return {
    scenarioFetcher: { getById: vi.fn().mockResolvedValue(null) },
    suiteConfigFetcher: { getBySetId: vi.fn().mockResolvedValue(null) },
    promptFetcher: { getPromptByIdOrHandle: vi.fn().mockResolvedValue(null) },
    agentFetcher: { findById: vi.fn().mockResolvedValue(httpAgent) },
    workflowVersionFetcher: { getLatestDsl: vi.fn().mockResolvedValue(null) },
    projectFetcher: {
      findUnique: vi.fn().mockResolvedValue({
        apiKey: "sk-lw-project",
        team: { organizationId: "org_1" },
      }),
    },
    modelParamsProvider: {
      prepare: vi.fn().mockRejectedValue(new Error("no model may be prepared")),
    },
    modelResolver: {
      resolve: vi.fn().mockRejectedValue(new Error("no model may be resolved")),
    },
    projectSecretsFetcher: { getSecrets: vi.fn().mockResolvedValue({}) },
    traceWaitBudgetResolver: {
      resolveTraceWaitTimeoutMs: vi.fn().mockResolvedValue(30_000),
    },
    sandboxKeyMinter: { mint: vi.fn().mockResolvedValue("sk-lw-run") },
    ...overrides,
  } as DataPrefetcherDependencies;
}

const context = {
  projectId: "proj_1",
  scenarioId: AGENT_TEST_SCENARIO_ID,
  setId: "__internal__proj_1__agent-test",
  batchRunId: "batch_1",
};

describe("prefetchScenarioData", () => {
  describe("given the agent test scenario id and an http agent", () => {
    /** @scenario "The child job of a test run carries the script and no model" */
    it("prepares the script, the adapter data and no model, reading no scenario", async () => {
      const prefetchDeps = deps();
      const onChildEnvReady = vi.fn();

      const result = await prefetchScenarioData({
        context,
        target: { type: "http", referenceId: "agent_http" },
        deps: prefetchDeps,
        onChildEnvReady,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.script).toEqual({
        kind: "agent_test",
        userMessage: "ping",
      });
      expect(result.data.scenario.id).toBe(AGENT_TEST_SCENARIO_ID);
      expect(result.data.scenario.name).toBe("Test ACME Support Agent");
      expect(result.data.adapterData.type).toBe("http");
      expect(result.data.modelParams).toBeUndefined();
      expect(result.data.simulatorModelParams).toBeUndefined();
      expect(result.data.judgeModelParams).toBeUndefined();
      expect(result.resolvedModels).toBeNull();
      expect(result.telemetry).toEqual({
        endpoint: "http://app:5560",
        apiKey: "sk-lw-project",
      });
      expect(prefetchDeps.scenarioFetcher.getById).not.toHaveBeenCalled();
      expect(prefetchDeps.modelResolver.resolve).not.toHaveBeenCalled();
      expect(prefetchDeps.modelParamsProvider.prepare).not.toHaveBeenCalled();
      expect(onChildEnvReady).toHaveBeenCalledWith({
        labels: [],
        telemetry: { endpoint: "http://app:5560", apiKey: "sk-lw-project" },
      });
    });
  });

  describe("given the agent test scenario id and a prompt target", () => {
    /** @scenario "An agent that is not run by scenarios is refused" */
    it("refuses: a prompt is run through a scenario, not tested this way", async () => {
      const result = await prefetchScenarioData({
        context,
        target: { type: "prompt", referenceId: "prompt_1" },
        deps: deps(),
      });
      expect(result).toMatchObject({ success: false });
      if (result.success) return;
      expect(result.error).toMatch(/prompt/i);
    });
  });

  describe("given the agent test scenario id and an agent that is gone", () => {
    /** @scenario "An agent the run cannot be prepared from is refused" */
    it("fails with the agent named", async () => {
      const result = await prefetchScenarioData({
        context,
        target: { type: "connected", referenceId: "agent_gone" },
        deps: deps({
          agentFetcher: { findById: vi.fn().mockResolvedValue(null) },
        }),
      });
      expect(result).toEqual({
        success: false,
        error: "Connected agent agent_gone not found",
      });
    });
  });
});
