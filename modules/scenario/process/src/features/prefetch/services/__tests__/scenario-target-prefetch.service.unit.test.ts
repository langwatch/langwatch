import {
  AgentNotFoundError,
  type Agent,
  type AgentApi,
  type AgentOverview,
  type Connector,
  type ConnectorStep,
} from "@langwatch/agent-contract";
import type { DatasetApi, DatasetPage } from "@langwatch/dataset-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { versionedPromptSchema, type PromptApi } from "@langwatch/prompt-contract";
import type { TargetConfig } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { WorkflowNotFoundError, type WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { ScenarioModelParametersService } from "../../../../services/scenario-model-parameters.service.ts";
import { ScenarioWorkflowHydratorService } from "../../../../services/scenario-workflow-hydrator.service.ts";
import { ScenarioTargetPrefetchService } from "../scenario-target-prefetch.service.ts";

const PROJECT_ID = "project-1";

type Answers = {
  agent?: Agent | "missing" | "down";
  prompt?: Record<string, unknown> | null;
  projectSecrets?: Record<string, string>;
  secretReads?: string[][];
  /** The dataset entries a Connector step's bound dataset holds; null when it is gone. */
  datasetEntries?: Record<string, unknown>[] | null;
  /** The dataset's total row count when it holds more than the page returned. */
  datasetCount?: number;
  /** Whether the project's runs may execute Connector steps; defaults to released. */
  connectorsReleased?: boolean;
};

function datasetPageOf(entries: Record<string, unknown>[], count = entries.length): DatasetPage {
  return {
    id: "dataset_personas",
    name: "Personas",
    columnTypes: [],
    datasetRecords: entries.map((entry, index) => ({
      id: `record_${index}`,
      datasetId: "dataset_personas",
      projectId: PROJECT_ID,
      entry,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    count,
    page: 1,
    limit: 1000,
    totalPages: 1,
  };
}

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
    list: async ({ projectId }) =>
      Object.keys(answers.projectSecrets ?? {}).map((name) => ({
        id: name,
        projectId,
        name,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        createdBy: { name: null },
        updatedBy: { name: null },
      })),
    getValuesByName: async ({ names }) => {
      answers.secretReads?.push(names);

      return Object.fromEntries(
        Object.entries(answers.projectSecrets ?? {}).filter(([name]) => names.includes(name)),
      );
    },
  });

  const datasets = createApiFixture<DatasetApi>({
    findDatasetPage: async () =>
      answers.datasetEntries ? datasetPageOf(answers.datasetEntries, answers.datasetCount) : null,
  });

  return ScenarioTargetPrefetchService.create({
    prompts,
    agents,
    workflows,
    secrets,
    datasets,
    connectorSteps: { isEnabled: async () => answers.connectorsReleased ?? true },
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

const httpAgent = (config: Extract<Agent, { type: "http" }>["config"]): Agent => ({
  id: "agent-1",
  projectId: PROJECT_ID,
  name: "http-agent",
  type: "http",
  config,
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  environment: "production",
  ownerUserId: null,
  hostLabel: null,
  identityKey: "http-agent@production",
  lastSeenAt: null,
});

/** A row as storage hands it back, which the agent contract's type no longer describes. */
function storedRow(row: Record<string, unknown>): Agent {
  return JSON.parse(JSON.stringify(row));
}

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

const TARGET_NOT_FOUND = { code: "scenario_target_not_found" };

const fetchFor = (
  service: ScenarioTargetPrefetchService,
  type: TargetConfig["type"],
  runSecretValues: Record<string, string> = {},
) => service.getTargetAdapter({ projectId: PROJECT_ID, target: target(type), runSecretValues });

describe("ScenarioTargetPrefetchService.getTargetAdapter", () => {
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

    it("throws target not found when the prompt is gone", async () => {
      await expect(fetchFor(serviceAnswering({ prompt: null }), "prompt")).rejects.toMatchObject(
        TARGET_NOT_FOUND,
      );
    });
  });

  describe("given an agent target that no longer exists", () => {
    it("throws target not found, which the prefetch turns into a failed run", async () => {
      // One deleted agent must not fail the prefetch for the whole batch.
      await expect(fetchFor(serviceAnswering({ agent: "missing" }), "http")).rejects.toMatchObject(
        TARGET_NOT_FOUND,
      );
      await expect(fetchFor(serviceAnswering({ agent: "missing" }), "code")).rejects.toMatchObject(
        TARGET_NOT_FOUND,
      );
      await expect(
        fetchFor(serviceAnswering({ agent: "missing" }), "workflow"),
      ).rejects.toMatchObject(TARGET_NOT_FOUND);
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
    const agent = httpAgent({
      url: "https://acme.test/chat",
      method: "POST",
      headers: [
        { key: "Authorization", value: "Bearer {{ secrets.TOKEN }}" },
        { key: "X-Other", value: "{{ secrets.OTHER }}" },
      ],
    });

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

    it("reads only the project secrets its config names", async () => {
      const secretReads: string[][] = [];
      const service = serviceAnswering({
        agent,
        projectSecrets: { TOKEN: "from-project", UNUSED: "never-sent" },
        secretReads,
      });

      const adapter = await fetchFor(service, "http");

      expect(adapter).toMatchObject({ secrets: { TOKEN: "from-project" } });
      expect(adapter).not.toMatchObject({ secrets: { UNUSED: "never-sent" } });
      expect(secretReads).toEqual([["TOKEN", "OTHER"]]);
    });

    it("reads no secret when its config names none", async () => {
      const secretReads: string[][] = [];
      const service = serviceAnswering({
        agent: httpAgent({ url: "https://acme.test/chat", method: "POST" }),
        projectSecrets: { TOKEN: "from-project" },
        secretReads,
      });

      await expect(fetchFor(service, "http")).resolves.toMatchObject({ secrets: {} });
      expect(secretReads).toEqual([]);
    });

    it("throws target not found when the configuration will not parse", async () => {
      // A half-configured agent cannot be run, and saying so here is cheaper
      // than a request that fails inside the sandbox.
      const service = serviceAnswering({
        agent: storedRow({ ...httpAgent({ url: "", method: "POST" }), config: { method: "POST" } }),
      });

      await expect(fetchFor(service, "http")).rejects.toMatchObject(TARGET_NOT_FOUND);
    });
  });

  describe("given an http agent with a Connector", () => {
    const step: ConnectorStep = {
      language: "python",
      code: "def execute(input):\n    return {}\n",
      secretNames: ["API_KEY"],
    };
    const withConnector = (connector: Connector) =>
      httpAgent({ url: "https://acme.test/chat", method: "POST", connector });

    /** @scenario "A Connector step receives only the secrets it names" */
    it("packs each step with only the secrets it names", async () => {
      const service = serviceAnswering({
        agent: withConnector({ setup: step }),
        projectSecrets: { API_KEY: "key-from-project", OTHER_KEY: "never-sent" },
      });

      const adapter = await fetchFor(service, "http");

      expect(adapter).toMatchObject({
        connector: {
          setup: {
            code: step.code,
            secretNames: ["API_KEY"],
            secrets: { API_KEY: "key-from-project" },
          },
        },
      });
      expect(JSON.stringify(adapter)).not.toContain("never-sent");
      expect(adapter).not.toHaveProperty("connector.teardown");
    });

    it("lets the run's own value of a named secret win, and nothing else of the run's", async () => {
      const service = serviceAnswering({
        agent: withConnector({ teardown: step }),
        projectSecrets: { API_KEY: "key-from-project" },
      });

      const adapter = await fetchFor(service, "http", {
        API_KEY: "key-from-run",
        RUN_ONLY: "not-named",
      });

      expect(adapter).toMatchObject({
        connector: { teardown: { secrets: { API_KEY: "key-from-run" } } },
      });
      expect(adapter).not.toHaveProperty("connector.teardown.secrets.RUN_ONLY");
    });

    it("packs a named secret the project lacks as missing, for the step to fail on", async () => {
      const service = serviceAnswering({ agent: withConnector({ setup: step }) });

      await expect(fetchFor(service, "http")).resolves.toMatchObject({
        connector: { setup: { secretNames: ["API_KEY"], secrets: {} } },
      });
    });

    /** @scenario "A hosted project without the Connector release flag does not run Connector steps" */
    it("packs only a refusal, and reads no secret or row, while the release is off", async () => {
      const service = serviceAnswering({
        agent: withConnector({ setup: { ...step, datasetId: "dataset_personas" } }),
        projectSecrets: { API_KEY: "key-from-project" },
        datasetEntries: [{ persona: "gold" }],
        connectorsReleased: false,
      });

      const adapter = await fetchFor(service, "http");

      expect(adapter).toMatchObject({
        connector: {
          setup: { refusal: expect.stringContaining("not released"), secrets: {}, secretNames: [] },
        },
      });
      expect(adapter).not.toHaveProperty("connector.setup.rows");
    });

    it("reads no project secret a step's code references, which only its named ones reach", async () => {
      const secretReads: string[][] = [];
      const service = serviceAnswering({
        agent: withConnector({
          setup: { ...step, secretNames: [], code: "key = '{{ secrets.HIDDEN_KEY }}'" },
        }),
        projectSecrets: { HIDDEN_KEY: "hidden-value" },
        secretReads,
        connectorsReleased: false,
      });

      const adapter = await fetchFor(service, "http");

      expect(secretReads.flat()).not.toContain("HIDDEN_KEY");
      expect(JSON.stringify(adapter)).not.toContain("hidden-value");
    });

    /** @scenario "A hosted project with the Connector release flag runs Connector steps" */
    it("packs no refusal while the release is on", async () => {
      const service = serviceAnswering({
        agent: withConnector({ setup: step }),
        connectorsReleased: true,
      });

      expect(await fetchFor(service, "http")).not.toHaveProperty("connector.setup.refusal");
    });

    /** @scenario "A Connector step bound to a dataset receives its rows" */
    it("packs the bound dataset's entries as rows", async () => {
      const rows = [{ persona: "gold" }, { persona: "basic" }];
      const service = serviceAnswering({
        agent: withConnector({ setup: { ...step, datasetId: "dataset_personas" } }),
        datasetEntries: rows,
      });

      await expect(fetchFor(service, "http")).resolves.toMatchObject({
        connector: { setup: { rows } },
      });
    });

    it("packs a refusal instead of rows over 64 KiB", async () => {
      const service = serviceAnswering({
        agent: withConnector({ setup: { ...step, datasetId: "dataset_personas" } }),
        datasetEntries: [{ notes: "x".repeat(64 * 1024) }],
      });

      const adapter = await fetchFor(service, "http");

      expect(adapter).toMatchObject({
        connector: { setup: { refusal: expect.stringContaining("64 KiB") } },
      });
      expect(adapter).not.toHaveProperty("connector.setup.rows");
    });

    it("packs a refusal naming the row limit when the dataset has more rows than a page", async () => {
      const service = serviceAnswering({
        agent: withConnector({ setup: { ...step, datasetId: "dataset_personas" } }),
        datasetEntries: [{ persona: "gold" }],
        datasetCount: 1001,
      });

      const refusal = (await fetchFor(service, "http")) as {
        connector: { setup: { refusal: string } };
      };

      expect(refusal.connector.setup.refusal).toMatch(/more than the \d+ rows/);
      expect(refusal.connector.setup.refusal).not.toContain("KiB");
    });

    it("packs a refusal when the bound dataset is gone", async () => {
      const service = serviceAnswering({
        agent: withConnector({ setup: { ...step, datasetId: "dataset_gone" } }),
        datasetEntries: null,
      });

      await expect(fetchFor(service, "http")).resolves.toMatchObject({
        connector: { setup: { refusal: expect.stringContaining("no longer exists") } },
      });
    });

    it("packs no Connector for an agent without one", async () => {
      const service = serviceAnswering({
        agent: httpAgent({ url: "https://acme.test/chat", method: "POST" }),
      });

      expect(await fetchFor(service, "http")).not.toHaveProperty("connector");
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
    it("throws target not found", async () => {
      const service = serviceAnswering({
        agent: httpAgent({ url: "https://acme.test", method: "POST" }),
      });

      await expect(fetchFor(service, "code")).rejects.toMatchObject(TARGET_NOT_FOUND);
    });
  });
});
