/**
 * What an agent test run's prefetch prepares: the scripted conversation,
 * @vitest-environment node
 * @see specs/agents/agent-test-run.feature
 */
import type { HttpAgentData } from "@langwatch/scenario-contract";
import { AGENT_TEST_SCENARIO_ID, AGENT_TEST_USER_MESSAGE } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { AgentTestPrefetchService } from "../agent-test-prefetch.service.ts";
import type { ScenarioExecutionPrefetchConfig } from "../scenario-execution-prefetcher.service.ts";

const config: ScenarioExecutionPrefetchConfig = {
  langwatchEndpoint: "http://app:5560",
  nlpServiceUrl: "http://nlp:5561",
  legacyDefaultModel: "openai/gpt-5-mini",
};

/** A deployment that does, or does not, run an engine per project. */
function prefetcher({ perProjectEngines = false } = {}) {
  return AgentTestPrefetchService.create({
    workflows: createApiFixture<WorkflowApi>({ hasPerProjectEngines: () => perProjectEngines }),
  });
}

const context = {
  projectId: "proj_1",
  scenarioId: AGENT_TEST_SCENARIO_ID,
  setId: "__internal__proj_1__agent-test",
  batchRunId: "batch_1",
};

const httpAdapterData: HttpAgentData = {
  type: "http",
  agentId: "agent_http",
  url: "https://acme.example/chat",
  method: "POST",
  headers: [],
  secrets: {},
};

describe("given the agent test scenario id and an http agent", () => {
  /** @scenario "The child job of a test run carries the script and no model" */
  it("prepares the script, the adapter data and no model, reading no scenario", async () => {
    const agentName = vi.fn().mockResolvedValue("ACME Support Agent");
    const adapter = vi.fn().mockResolvedValue(httpAdapterData);

    const result = await prefetcher().prefetch({
      context: {
        projectId: "proj_1",
        scenarioId: AGENT_TEST_SCENARIO_ID,
        setId: "__internal__proj_1__agent-test",
        batchRunId: "batch_1",
      },
      target: { type: "http", referenceId: "agent_http" },
      reads: {
        project: () => Promise.resolve({ success: true, data: { organizationId: "org_1" } }),
        adapter,
        agentName,
        runKey: () => Promise.resolve("run-key"),
      },
      config,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.script).toEqual({
      kind: "agent_test",
      userMessage: AGENT_TEST_USER_MESSAGE,
    });
    expect(result.data.scenario.id).toBe(AGENT_TEST_SCENARIO_ID);
    expect(result.data.scenario.name).toBe("Test ACME Support Agent");
    expect(result.data.adapterData).toEqual(httpAdapterData);
    expect(result.telemetry.apiKey).toBe("run-key");
    expect(result.resolvedModels).toBeNull();
    expect(agentName).toHaveBeenCalled();
    expect(adapter).toHaveBeenCalled();
  });
});

describe("given the agent test scenario id and a voice target", () => {
  /** @scenario "A voice agent is refused by the agent-test path" */
  it("refuses it: voice agents are tested by talking to them or by running a scenario", async () => {
    const adapter = vi.fn();

    const result = await prefetcher().prefetch({
      context,
      target: { type: "voice", referenceId: "agent_voice" },
      reads: {
        project: () => Promise.resolve({ success: true, data: { organizationId: "org_1" } }),
        adapter,
        agentName: () => Promise.resolve("Support line"),
        runKey: () => Promise.resolve("run-key"),
      },
      config,
    });

    expect(result).toEqual({
      success: false,
      error: "Voice agents are tested by talking to them or by running a scenario",
    });
    expect(adapter).not.toHaveBeenCalled();
  });
});

describe("given an agent test turn prepared for a code agent", () => {
  const codeAdapterData = {
    type: "code" as const,
    agentId: "agent_code",
    code: "class Code: ...",
    inputs: [],
    outputs: [],
    secrets: {},
  };

  async function routeOf({ perProjectEngines }: { perProjectEngines: boolean }) {
    const result = await prefetcher({ perProjectEngines }).prefetch({
      context,
      target: { type: "code", referenceId: "agent_code" },
      reads: {
        project: () => Promise.resolve({ success: true, data: { organizationId: "org_1" } }),
        adapter: () => Promise.resolve(codeAdapterData),
        agentName: () => Promise.resolve("Code agent"),
        runKey: () => Promise.resolve("run-key"),
      },
      config: { ...config, publicBaseUrl: "https://app.langwatch.example" },
    });
    if (!result.success) throw new Error(result.error);
    return result.data.executeSyncRoute;
  }

  describe("when the deployment runs an engine per project", () => {
    /** @scenario "The agent-test turn takes the same route as every other turn" */
    it("routes the turn through the control plane at the address the platform hands out", async () => {
      await expect(routeOf({ perProjectEngines: true })).resolves.toEqual({
        mode: "relay",
        relayBaseUrl: "http://app:5560",
      });
    });
  });

  describe("when the deployment has one engine", () => {
    /** @scenario "A self-hosted agent-test turn posts to the engine directly" */
    it("routes the turn straight to the configured engine", async () => {
      await expect(routeOf({ perProjectEngines: false })).resolves.toEqual({
        mode: "direct",
        nlpServiceUrl: "http://nlp:5561",
      });
    });
  });
});
