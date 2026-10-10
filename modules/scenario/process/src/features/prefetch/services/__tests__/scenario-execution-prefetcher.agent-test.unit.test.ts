/**
 * The worker's prefetch of a queued agent test run reads no scenario row (WEB-5200).
 * @vitest-environment node
 * @see specs/agents/agent-test-run.feature
 */
import {
  AgentNotFoundError,
  type Agent,
  type AgentApi,
  type AgentOverview,
} from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { AGENT_TEST_SCENARIO_ID, getAgentTestSetId } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type { ScenarioRunSecretSeal } from "../../../../repositories/scenario.repository.ts";
import type { ScenarioService } from "../../../../services/scenario.service.ts";
import { ScenarioExecutionPrefetcherService } from "../scenario-execution-prefetcher.service.ts";

const PROJECT_ID = "project-1";

const httpAgent: Agent = JSON.parse(
  JSON.stringify({
    id: "agent-1",
    projectId: PROJECT_ID,
    name: "Support bot",
    type: "http",
    config: { url: "https://acme.example/chat", method: "POST" },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    environment: "production",
    ownerUserId: null,
    hostLabel: null,
    identityKey: "support-bot@production",
    lastSeenAt: null,
  }),
);

/** A prefetcher whose scenario store throws on any read, so reading a row fails the test. */
function prefetcher({ agent }: { agent: Agent | "missing" }) {
  return ScenarioExecutionPrefetcherService.create({
    runSecretSeal: createApiFixture<ScenarioRunSecretSeal>({}),
    config: {
      langwatchEndpoint: "http://app:5560",
      nlpServiceUrl: "http://nlp:5561",
      legacyDefaultModel: "openai/gpt-5-mini",
    },
    scenarios: createApiFixture<ScenarioService>({}, "scenario store (must not be read)"),
    prompts: createApiFixture<PromptApi>({}),
    agents: createApiFixture<AgentApi>({
      getById: async () => {
        if (agent === "missing") throw new AgentNotFoundError("agent-1");
        const overview: AgentOverview = {
          ...agent,
          environment: agent.environment ?? null,
          ownerUserId: agent.ownerUserId ?? null,
          hostLabel: agent.hostLabel ?? null,
          lastSeenAt: agent.lastSeenAt ?? null,
          inputFields: [],
          outputFields: [],
          fieldsResolved: true,
          parameters: [],
          owner: null,
          status: "offline",
          instances: [],
          selectable: true,
          notSelectableReason: null,
        };
        return overview;
      },
      getNamesByIds: async () => (agent === "missing" ? [] : [{ id: agent.id, name: agent.name }]),
    }),
    workflows: createApiFixture<WorkflowApi>({ hasPerProjectEngines: () => false }),
    projects: createApiFixture<ProjectApi>({
      findById: async () => JSON.parse(JSON.stringify({ id: PROJECT_ID })),
    }),
    modelProviders: createApiFixture<ModelProviderApi>({}),
    secrets: createApiFixture<SecretApi>({
      list: async () => [],
      getValuesByName: async () => ({}),
    }),
    traces: createApiFixture<TraceApi>({}),
    apiKeys: createApiFixture<Pick<ApiKeyApi, "mintRunKey" | "mintAgentSandboxKey">>({
      mintRunKey: async () => "run-key",
    }),
    voiceTargets: null,
  });
}

const input = {
  context: {
    projectId: PROJECT_ID,
    scenarioId: AGENT_TEST_SCENARIO_ID,
    setId: getAgentTestSetId(PROJECT_ID),
    batchRunId: "batch-1",
  },
  target: { type: "http" as const, referenceId: "agent-1" },
};

describe("given a queued agent test run of an http agent", () => {
  /** @scenario "The worker prefetches a queued test run without a scenario row" */
  it("prepares the scripted run and starts the child, reading no scenario", async () => {
    const preparation = prefetcher({ agent: httpAgent }).prepare(input);

    const result = await preparation.result;
    expect(result).toMatchObject({
      success: true,
      data: {
        scenario: { id: AGENT_TEST_SCENARIO_ID, name: "Test Support bot" },
        script: { kind: "agent_test" },
      },
    });
    expect(await preparation.childEnvironment).toMatchObject({ telemetry: { apiKey: "run-key" } });
  });

  describe("when the agent is gone", () => {
    it("fails on the agent, not on a missing scenario, and starts no child", async () => {
      const preparation = prefetcher({ agent: "missing" }).prepare(input);

      expect(await preparation.result).toEqual({
        success: false,
        error: "HTTP agent agent-1 not found",
      });
      expect(await preparation.childEnvironment).toBeNull();
    });
  });
});
