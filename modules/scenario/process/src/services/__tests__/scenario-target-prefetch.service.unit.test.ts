import {
  AgentNotFoundError,
  type Agent,
  type AgentApi,
  type AgentOverview,
} from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { versionedPromptSchema, type PromptApi } from "@langwatch/prompt-contract";
import type { TargetConfig } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { WorkflowNotFoundError, type WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { ScenarioModelParametersService } from "../scenario-model-parameters.service.ts";
import { ScenarioTargetPrefetchService } from "../scenario-target-prefetch.service.ts";
import { ScenarioWorkflowHydratorService } from "../scenario-workflow-hydrator.service.ts";

const PROJECT_ID = "project-1";

type Answers = {
  agent?: Agent | "missing" | "down";
  prompt?: Record<string, unknown> | null;
  projectSecrets?: Record<string, string>;
};

function serviceAnswering(answers: Answers = {}) {
  const prompts = createApiFixture<PromptApi>({
    findByIdOrHandle: async (input) => {
      if (!answers.prompt) return null;
      return versionedPromptSchema.parse({
        id: input.idOrHandle,
        name: "Test prompt",
        handle: null,
        scope: "PROJECT",
        version: 1,
        versionId: `${input.idOrHandle}-version`,
        versionCreatedAt: new Date(0),
        model: "openai/gpt-5-mini",
        prompt: "",
        projectId: input.projectId,
        organizationId: "organization-1",
        messages: [],
        authorId: null,
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        updatedAt: new Date(0),
        createdAt: new Date(0),
        tags: [],
        parameters: {},
        ...answers.prompt,
      });
    },
  });

  const agents = createApiFixture<AgentApi>({
    getById: async () => {
      if (answers.agent === "down") throw new Error("agent service unreachable");
      if (answers.agent === undefined || answers.agent === "missing") {
        throw new AgentNotFoundError("agent-1");
      }

      const agent = answers.agent;
      const overview: AgentOverview = {
        ...agent,
        inputFields: [],
        outputFields: [],
        fieldsResolved: true,
        environment: agent.environment ?? null,
        ownerUserId: agent.ownerUserId ?? null,
        hostLabel: agent.hostLabel ?? null,
        lastSeenAt: agent.lastSeenAt ?? null,
        parameters: [],
        owner: null,
        status: "offline",
        instances: [],
        selectable: true,
        notSelectableReason: null,
      };
      return overview;
    },
  });

  const workflows = createApiFixture<WorkflowApi>({
    getById: async () => {
      throw new WorkflowNotFoundError("workflow-1");
    },
  });

  const secrets = createApiFixture<SecretApi>({
    getValues: async () => answers.projectSecrets ?? {},
  });

  return ScenarioTargetPrefetchService.create({
    prompts,
    agents,
    workflows,
    secrets,
    // Never reached: every workflow lookup below answers not-found, so the
    // target is refused before anything is hydrated.
    workflowHydrator: ScenarioWorkflowHydratorService.create(
      ScenarioModelParametersService.create(createApiFixture<ModelProviderApi>({})),
    ),
    legacyDefaultModel: "openai/gpt-5-mini",
    langwatchEndpoint: "https://app.langwatch.test",
    voiceTargets: null,
  });
}

const httpAgent = (config: Record<string, unknown>): Agent =>
  ({ id: "agent-1", type: "http", config }) as unknown as Agent;

const connectedAgent = (timeoutMs: number): Agent => ({
  id: "agent-1",
  projectId: PROJECT_ID,
  name: "support-agent",
  type: "connected",
  config: {
    parameters: [],
    sdk: { name: "langwatch", version: "1.0.0", language: "typescript" },
    timeoutMs,
  },
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  environment: "production",
  ownerUserId: null,
  hostLabel: null,
  identityKey: "support-agent@production",
  lastSeenAt: new Date(0),
});

const target = (type: TargetConfig["type"], referenceId = "agent-1"): TargetConfig => ({
  type,
  referenceId,
});

const fetchFor = (
  service: ScenarioTargetPrefetchService,
  type: TargetConfig["type"],
  runSecretValues: Record<string, string> = {},
) => service.fetch({ projectId: PROJECT_ID, target: target(type), runSecretValues });

describe("ScenarioTargetPrefetchService.tryFetch", () => {
  describe("given a prompt target", () => {
    it("packs the prompt the run will send", async () => {
      const service = serviceAnswering({
        prompt: { id: "prompt-1", prompt: "You are helpful", messages: [], inputs: [] },
      });

      await expect(fetchFor(service, "prompt")).resolves.toMatchObject({
        type: "prompt",
        promptId: "prompt-1",
        systemPrompt: "You are helpful",
      });
    });

    it("answers with nothing when the prompt is gone", async () => {
      await expect(fetchFor(serviceAnswering({ prompt: null }), "prompt")).resolves.toBeNull();
    });
  });

  describe("given an agent target that no longer exists", () => {
    it("answers with nothing rather than throwing", async () => {
      // One deleted agent must not fail the prefetch for the whole batch.
      await expect(fetchFor(serviceAnswering({ agent: "missing" }), "http")).resolves.toBeNull();
      await expect(fetchFor(serviceAnswering({ agent: "missing" }), "code")).resolves.toBeNull();
      await expect(
        fetchFor(serviceAnswering({ agent: "missing" }), "workflow"),
      ).resolves.toBeNull();
    });
  });

  describe("given the agent service is unreachable", () => {
    it("propagates the failure rather than reporting the agent deleted", async () => {
      // DOWN is a retry; GONE tells the customer their scenario is broken.
      await expect(fetchFor(serviceAnswering({ agent: "down" }), "http")).rejects.toThrow(
        "agent service unreachable",
      );
    });
  });

  describe("given an http agent", () => {
    const agent = httpAgent({ url: "https://acme.test/chat", method: "POST" });

    it("packs the request the run will make", async () => {
      const service = serviceAnswering({ agent });

      await expect(fetchFor(service, "http")).resolves.toMatchObject({
        type: "http",
        agentId: "agent-1",
        url: "https://acme.test/chat",
        method: "POST",
      });
    });

    it("carries the project's secrets, because the sandbox cannot read them", async () => {
      const service = serviceAnswering({ agent, projectSecrets: { TOKEN: "from-project" } });

      await expect(fetchFor(service, "http")).resolves.toMatchObject({
        secrets: { TOKEN: "from-project" },
      });
    });

    it("lets the run's own values override the project's", async () => {
      const service = serviceAnswering({ agent, projectSecrets: { TOKEN: "from-project" } });

      await expect(fetchFor(service, "http", { TOKEN: "from-run" })).resolves.toMatchObject({
        secrets: { TOKEN: "from-run" },
      });
    });

    it("keeps a project secret the run did not override", async () => {
      const service = serviceAnswering({
        agent,
        projectSecrets: { TOKEN: "from-project", OTHER: "kept" },
      });

      await expect(fetchFor(service, "http", { TOKEN: "from-run" })).resolves.toMatchObject({
        secrets: { TOKEN: "from-run", OTHER: "kept" },
      });
    });

    it("answers with nothing when the configuration will not parse", async () => {
      // A half-configured agent cannot be run, and saying so here is cheaper
      // than a request that fails inside the sandbox.
      const service = serviceAnswering({ agent: httpAgent({ method: "POST" }) });

      await expect(fetchFor(service, "http")).resolves.toBeNull();
    });
  });

  describe("given a connected agent", () => {
    it("packs the platform endpoint and caps the child adapter timeout", async () => {
      const service = serviceAnswering({ agent: connectedAgent(999_999) });

      await expect(fetchFor(service, "connected")).resolves.toEqual({
        type: "connected",
        agentId: "agent-1",
        endpoint: "https://app.langwatch.test",
        timeoutMs: 300_000,
      });
    });
  });

  describe("given the agent is not the type the target claims", () => {
    it("answers with nothing", async () => {
      const service = serviceAnswering({
        agent: httpAgent({ url: "https://acme.test", method: "POST" }),
      });

      await expect(fetchFor(service, "code")).resolves.toBeNull();
    });
  });
});
