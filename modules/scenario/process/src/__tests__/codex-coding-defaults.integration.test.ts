/** @vitest-environment node
 * Codex in FAST/coding-default: project runs simulations against workflow/code/http targets.
 * The model-provider boundary is scripted from its own feature registry: FAST-role features
 * resolve the codex default, which refuses direct execution as the real backstop does.
 */
import type { Agent } from "@langwatch/agent-contract";
import {
  CODEX_DEFAULT_MODEL,
  findFeatureByKey,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";
import type { TargetConfig } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  createTestScenarioExecutionPrefetcherService,
  type ScenarioPrefetchFixture,
} from "./support/scenario-execution-prefetcher.fixture.ts";

const DEFAULT_ROLE_MODEL = "openai/gpt-5-mini";
const PROJECT_ID = "project_codex";

/** The project's defaults: FAST is the codex model "apply coding defaults" writes. */
const modelProviders = createApiFixture<ModelProviderApi>({
  findProviderForProject: async () => null,
  getExecutionProviders: async () => ({}),
  findResolvedDefault: async ({ featureKey }) => ({
    model:
      findFeatureByKey(featureKey)[0]?.role === "FAST" ? CODEX_DEFAULT_MODEL : DEFAULT_ROLE_MODEL,
    source: "role_default",
    scope: "project",
  }),
  prepareExecution: async ({ model }) => {
    if (model === CODEX_DEFAULT_MODEL) {
      throw new Error("Codex models run on coding-assistant surfaces only");
    }
    return { model, api_key: "sk-openai-test" };
  },
});

describe("given a project whose FAST role default is a codex model", () => {
  const httpAgent: Agent = {
    id: "agent_http",
    type: "http" as const,
    name: "HTTP agent",
    config: { url: "https://example.com/chat", method: "POST", headers: [] },
    projectId: "",
    workflowId: null,
    copiedFromAgentId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
  };
  const codeAgent: Agent = {
    id: "agent_code",
    type: "code" as const,
    name: "Code agent",
    config: {
      parameters: [
        { identifier: "code", type: "code", value: "def execute(input):\n    return input" },
      ],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
    projectId: "",
    workflowId: null,
    copiedFromAgentId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
  };
  const workflowAgent: Agent = {
    id: "agent_workflow",
    type: "workflow" as const,
    name: "Workflow agent",
    config: { workflow_id: "wf_codex" },
    projectId: "",
    workflowId: "wf_codex",
    copiedFromAgentId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
  };

  function fixtureFor(agent: Agent) {
    return {
      scenarioFetcher: {
        getById: async () => ({
          id: "scen_codex",
          name: "Codex coding defaults scenario",
          situation: "User asks a question",
          criteria: ["Responds politely"],
          labels: [],
        }),
      },
      suiteConfigFetcher: { getBySetId: async () => null },
      promptFetcher: { findByIdOrHandle: async () => null },
      agentFetcher: { findById: async () => ({ ...agent, projectId: PROJECT_ID }) },
      workflowVersionFetcher: {
        getLatestDsl: async () => ({
          workflowId: "wf_codex",
          dsl: { spec_version: "1.5", nodes: [], edges: [] },
        }),
      },
      projectFetcher: { findUnique: async () => ({ apiKey: "test-platform-key" }) },
      // Never consulted: `modelProviders` below replaces the stand-in these feed.
      modelParamsProvider: {
        prepare: async () => {
          throw new Error("the real model-provider service answers here");
        },
      },
      modelResolver: {
        resolve: async () => {
          throw new Error("the real model-provider service answers here");
        },
      },
      projectSecretsFetcher: { getSecrets: async () => ({}) },
      traceWaitBudgetResolver: { resolveTraceWaitTimeoutMs: async () => 1_000 },
      modelProviders,
    } satisfies ScenarioPrefetchFixture;
  }

  const cases: {
    label: "workflow" | "code" | "http";
    agent: Agent;
  }[] = [
    { label: "workflow", agent: workflowAgent },
    { label: "code", agent: codeAgent },
    { label: "http", agent: httpAgent },
  ];

  describe("when the codex model is asked to execute directly", () => {
    // The premise the three cases below rest on: this composition really does
    // carry the production backstop, so a prefetch that resolved the FAST
    // role for a non-prompt target would be refused rather than pass silently.
    it("is refused by the coding-assistant backstop", async () => {
      await expect(
        modelProviders.prepareExecution({ projectId: PROJECT_ID, model: CODEX_DEFAULT_MODEL }),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });

  describe.each(cases)("when the run is prefetched for a $label target", ({ label, agent }) => {
    /** @scenario Coding defaults never break a simulation run */
    /** @scenario "A project whose FAST/coding default is codex still runs workflow, code, and http simulations" */
    it("prefetches successfully instead of hitting the codex coding-assistant backstop", async () => {
      const target: TargetConfig = { type: label, referenceId: agent.id };

      const result = await createTestScenarioExecutionPrefetcherService(fixtureFor(agent), {
        langwatchEndpoint: "http://app:5560",
        nlpServiceUrl: "http://langwatch_nlp:5561",
        legacyDefaultModel: DEFAULT_ROLE_MODEL,
      }).prefetch({
        context: {
          projectId: PROJECT_ID,
          scenarioId: "scen_codex",
          setId: `set_${label}`,
          batchRunId: `batch_${label}`,
        },
        target,
      });

      expect(
        result.success,
        `prefetch failed for ${label} target: ${result.success ? "" : result.error}`,
      ).toBe(true);
    });
  });
});
