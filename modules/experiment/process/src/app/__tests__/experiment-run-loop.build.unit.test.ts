/**
 * @vitest-environment node
 */
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { createInitialUIState } from "@langwatch/experiment-contract";
import type { ModelCost, ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type { ExperimentAttachmentInputService } from "../../services/experiment-attachment-input.service.ts";
import type { ExecutionDataServices } from "../../services/experiment-execution-data.service.ts";
import type { ExperimentService } from "../../services/experiment.service.ts";
import { buildExperimentRunLoop } from "../experiment-composition.build.ts";
import type { ExperimentV3StartRunInput } from "../experiment-workbench.members.ts";

/** The three Redis commands the run's progress and stop signal use, over one map. */
function redisKeys(): ProcessMembers["redis"] {
  const keys = new Map<string, string>();
  return createApiFixture<ProcessMembers["redis"]>(
    {
      get: async (key: unknown) => keys.get(String(key)) ?? null,
      set: async (...args: unknown[]) => {
        keys.set(String(args[0]), String(args[1]));
        return "OK";
      },
      del: async (...args: unknown[]) => (keys.delete(String(args[0])) ? 1 : 0),
    },
    "redis",
  );
}

const projectRule: ModelCost = {
  id: "cost_1",
  organizationId: "organization_1",
  projectId: "project_1",
  scopeType: "PROJECT",
  scopeId: "project_1",
  model: "my-fine-tune",
  regex: "^my-fine-tune$",
  inputCostPerToken: 0.001,
  outputCostPerToken: 0.002,
  cacheReadCostPerToken: null,
  cacheCreationCostPerToken: null,
  cacheCreation1hCostPerToken: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function build({
  redis,
  publicBaseUrl,
  mint = async () => "sandbox-key",
  findOrganizationId = async () => "organization_1",
}: {
  redis: ProcessMembers["redis"] | undefined;
  publicBaseUrl: string | undefined;
  mint?: ApiKeyApi["getOrMintAgentSandboxKey"];
  findOrganizationId?: ProjectApi["findOrganizationId"];
}) {
  const priced: Record<string, unknown>[] = [];
  const loop = buildExperimentRunLoop({
    redis,
    publicBaseUrl,
    processName: "langwatch-test",
    logger: { warn: () => undefined },
    experiments: createApiFixture<ExperimentService>({}, "experiments"),
    services: createApiFixture<ExecutionDataServices>({}, "services"),
    attachments: createApiFixture<ExperimentAttachmentInputService>({}, "attachments"),
    connectedAgentOwnership: createApiFixture<SuiteApi>({}, "connectedAgentOwnership"),
    dependencies: {
      workflows: createApiFixture<WorkflowApi>({}, "workflows"),
      modelProviders: createApiFixture<ModelProviderApi>({
        listCosts: async () => [projectRule],
        estimateCost: ({ attrs }) => {
          priced.push(attrs);
          return 0.5;
        },
      }),
      evaluation: createApiFixture<EvaluationApi>({}, "evaluation"),
      projects: createApiFixture<ProjectApi>({ findOrganizationId }),
      apiKeys: createApiFixture<ApiKeyApi>({ getOrMintAgentSandboxKey: mint }),
      agents: createApiFixture<AgentApi>({}, "agents"),
    },
  });
  return { loop, priced };
}

const runInput: ExperimentV3StartRunInput = {
  projectId: "project_1",
  projectSlug: "acme",
  experimentId: "experiment_1",
  experimentSlug: "checkout-eval",
  state: {
    name: "Checkout eval",
    datasets: [],
    activeDatasetId: "dataset-1",
    targets: [],
    evaluators: [],
    results: {
      status: "running",
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    },
    pendingSavedChanges: {},
    ui: createInitialUIState(),
  },
  datasetRows: [],
  datasetColumns: [],
  loadedPrompts: new Map(),
  loadedAgents: new Map(),
};

describe("buildExperimentRunLoop", () => {
  describe("given a process with no Redis", () => {
    /** @scenario "A process without Redis refuses to start a run by name" */
    it("refuses to start a run, naming the progress store", async () => {
      const { loop } = build({ redis: undefined, publicBaseUrl: "https://app.test" });

      await expect(loop.startRun(runInput)).rejects.toMatchObject({
        code: "service_unavailable",
        meta: { process: "langwatch-test", capability: expect.stringMatching(/^progress store/) },
      });
      expect(loop.ports).toBeNull();
      expect(loop.progress).toBeNull();
    });
  });

  describe("given a process with Redis but no public address", () => {
    /** @scenario "A process without a public address refuses to start a run but still answers polls" */
    it("refuses to start a run and keeps the progress store for polls", async () => {
      const { loop } = build({ redis: redisKeys(), publicBaseUrl: undefined });

      await expect(loop.startRun(runInput)).rejects.toMatchObject({
        code: "service_unavailable",
        meta: { process: "langwatch-test", capability: expect.stringMatching(/^public address/) },
      });
      expect(loop.ports).toBeNull();
      await expect(loop.progress?.findRunState("run_1")).resolves.toBeNull();
    });
  });

  describe("given a process with Redis and a public address", () => {
    /** @scenario "A run's stop signal is shared through the deployment's Redis" */
    it("records a stop request where every replica reads it", async () => {
      const { loop } = build({ redis: redisKeys(), publicBaseUrl: "https://app.test" });

      await loop.ports?.abort.requestAbort("run_1");

      await expect(loop.ports?.abort.isAborted("run_1")).resolves.toBe(true);
      await expect(loop.ports?.abort.isAborted("run_2")).resolves.toBe(false);
    });

    /** @scenario "A cell is priced at the project's own cost rule before the catalogue" */
    it("prices a cell with the project's matching rule as the custom rate", async () => {
      const { loop, priced } = build({ redis: redisKeys(), publicBaseUrl: "https://app.test" });

      const price = await loop.ports?.cost.findTokenPrice({
        projectId: "project_1",
        model: "my-fine-tune",
        inputTokens: 10,
        outputTokens: 5,
      });

      expect(price).toBe(0.5);
      expect(priced).toEqual([
        {
          "langwatch.model.inputCostPerToken": 0.001,
          "langwatch.model.outputCostPerToken": 0.002,
        },
      ]);
    });

    /** @scenario "A run lends the project's shared sandbox key to the code it executes" */
    it("lends the project's sandbox key", async () => {
      const { loop } = build({ redis: redisKeys(), publicBaseUrl: "https://app.test" });

      await expect(
        loop.ports?.sandboxCredentials.findRunKey({ projectId: "project_1" }),
      ).resolves.toBe("sandbox-key");
    });

    /** @scenario "A run whose sandbox key cannot be minted still runs without one" */
    it("lends no key when the mint refuses", async () => {
      const { loop } = build({
        redis: redisKeys(),
        publicBaseUrl: "https://app.test",
        mint: async () => {
          throw new Error("mint refused");
        },
      });

      await expect(
        loop.ports?.sandboxCredentials.findRunKey({ projectId: "project_1" }),
      ).resolves.toBeUndefined();
    });

    it("lends no key for a project with no organization", async () => {
      const { loop } = build({
        redis: redisKeys(),
        publicBaseUrl: "https://app.test",
        findOrganizationId: async () => undefined,
      });

      await expect(
        loop.ports?.sandboxCredentials.findRunKey({ projectId: "project_1" }),
      ).resolves.toBeUndefined();
    });
  });
});
