/**
 * What a scenario run is actually going to execute.
 *
 * The run happens in a child process with no database access, so everything
 * the target needs has to be resolved and packed here: the prompt or agent
 * configuration, and every secret its url, headers or code will reference.
 * A gap left here becomes a failure inside the sandbox, where the reason is
 * much harder to see.
 *
 * Two rules carry the most weight. A target that no longer exists answers
 * `null` rather than throwing, so the run reports that its target is gone
 * instead of crashing the prefetch for every other target in the batch. And
 * the run's own secret values win over the project's, because that override
 * is the whole point of passing them.
 */

import { describe, expect, it } from "vitest";
import { AgentNotFoundError, type Agent, type AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { SecretService } from "@langwatch/secret-contract";
import { WorkflowNotFoundError, type WorkflowService } from "@langwatch/workflow-contract";
import type { TargetConfig } from "@langwatch/scenario-contract";
import { ScenarioTargetPrefetchService } from "../scenario-target-prefetch.service";
import { ScenarioWorkflowHydratorService } from "../scenario-workflow-hydrator.service";

const PROJECT_ID = "project-1";

type Answers = {
  agent?: Agent | "missing" | "down";
  prompt?: Record<string, unknown> | null;
  projectSecrets?: Record<string, string>;
};

function serviceAnswering(answers: Answers = {}) {
  const prompts = {
    tryGetPromptByIdOrHandle: async () => answers.prompt ?? null,
  } as unknown as PromptService;

  const agents = {
    getById: async () => {
      if (answers.agent === "down") throw new Error("agent service unreachable");
      if (answers.agent === undefined || answers.agent === "missing") {
        throw new AgentNotFoundError("agent-1");
      }

      return answers.agent;
    },
  } as unknown as AgentService;

  const workflows = {
    getById: async () => {
      throw new WorkflowNotFoundError("workflow-1");
    },
  } as unknown as WorkflowService;

  const secrets = {
    getValues: async () => answers.projectSecrets ?? {},
  } as unknown as SecretService;

  return ScenarioTargetPrefetchService.create({
    prompts,
    agents,
    workflows,
    secrets,
    workflowHydrator: ScenarioWorkflowHydratorService.create(),
    legacyDefaultModel: "openai/gpt-5-mini",
  });
}

const httpAgent = (config: Record<string, unknown>): Agent =>
  ({ id: "agent-1", type: "http", config }) as unknown as Agent;

const target = (type: TargetConfig["type"], referenceId = "agent-1"): TargetConfig => ({
  type,
  referenceId,
});

const fetchFor = (
  service: ScenarioTargetPrefetchService,
  type: TargetConfig["type"],
  runSecretValues: Record<string, string> = {},
) => service.tryFetch({ projectId: PROJECT_ID, target: target(type), runSecretValues });

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

  describe("given the agent is not the type the target claims", () => {
    it("answers with nothing", async () => {
      const service = serviceAnswering({
        agent: httpAgent({ url: "https://acme.test", method: "POST" }),
      });

      await expect(fetchFor(service, "code")).resolves.toBeNull();
    });
  });
});
