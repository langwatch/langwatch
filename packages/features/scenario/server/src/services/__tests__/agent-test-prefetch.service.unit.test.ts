/**
 * What an agent test run's prefetch prepares: the scripted conversation,
 * @vitest-environment node
 * @see specs/agents/agent-test-run.feature
 */
import type { HttpAgentData } from "@langwatch/scenario-contract";
import { AGENT_TEST_SCENARIO_ID, AGENT_TEST_USER_MESSAGE } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";
import { AgentTestPrefetchService } from "../agent-test-prefetch.service";
import type { ScenarioExecutionPrefetchConfig } from "../scenario-execution-prefetcher.service";

const config: ScenarioExecutionPrefetchConfig = {
  langwatchEndpoint: "http://app:5560",
  nlpServiceUrl: "http://nlp:5561",
  legacyDefaultModel: "openai/gpt-5-mini",
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

    const result = await AgentTestPrefetchService.create().prefetch({
      context: {
        projectId: "proj_1",
        scenarioId: AGENT_TEST_SCENARIO_ID,
        setId: "__internal__proj_1__agent-test",
        batchRunId: "batch_1",
      },
      target: { type: "http", referenceId: "agent_http" },
      reads: {
        project: () =>
          Promise.resolve({
            success: true,
            data: { apiKey: "sk-lw-project", organizationId: "org_1" },
          }),
        adapter,
        agentName,
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
    expect(result.resolvedModels).toBeNull();
    expect(agentName).toHaveBeenCalled();
    expect(adapter).toHaveBeenCalled();
  });
});
