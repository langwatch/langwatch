/**
 * The verified server-side fallback for a navigate id the conversation never
 * cached a link for. Prod wires this as the relay's `resolveResourceUrl`, but
 * the relay tests inject a stub for it: so this is where its real contract is
 * pinned: the prefix-keyed resolver table, the tenancy-scoped lookup through
 * the platform's own services, null-on-miss (unknown resource OR unresolvable
 * project), and the fact that the address is PLATFORM-computed, never
 * agent-authored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({
  env: { BASE_HOST: "https://app.langwatch.ai" },
}));

const {
  getScenarioRunData,
  getProjectById,
  findExperimentById,
  getPromptByIdOrHandle,
  getDatasetBySlugOrId,
  getEvaluatorById,
  getAgentByIdOrThrow,
  workflowFindFirst,
  monitorFindFirst,
} = vi.hoisted(() => ({
  getScenarioRunData: vi.fn(),
  getProjectById: vi.fn(),
  findExperimentById: vi.fn(),
  getPromptByIdOrHandle: vi.fn(),
  getDatasetBySlugOrId: vi.fn(),
  getEvaluatorById: vi.fn(),
  getAgentByIdOrThrow: vi.fn(),
  workflowFindFirst: vi.fn(),
  monitorFindFirst: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    simulations: { runs: { getScenarioRunData } },
    projects: { getById: getProjectById },
    experiments: { findById: findExperimentById },
  }),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    workflow: { findFirst: workflowFindFirst },
    monitor: { findFirst: monitorFindFirst },
  },
}));

vi.mock("~/server/prompt-config/prompt.service", () => ({
  PromptService: class {
    getPromptByIdOrHandle = getPromptByIdOrHandle;
  },
}));

vi.mock("~/server/datasets/dataset.service", () => ({
  DatasetService: { create: () => ({ getBySlugOrId: getDatasetBySlugOrId }) },
}));

vi.mock("~/server/evaluators/evaluator.service", () => ({
  EvaluatorService: { create: () => ({ getById: getEvaluatorById }) },
}));

vi.mock("~/server/agents/agent.service", () => ({
  AgentService: { create: () => ({ getByIdOrThrow: getAgentByIdOrThrow }) },
}));

import { resolveNavigateFallbackUrl } from "../langyNavigateFallback";

const RUN_ID = "scenariorun_0002Gu9QAAAABBBBCCCCDDDDEEE";
const DRAWER_URL =
  "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail" +
  `&drawer.scenarioRunId=${RUN_ID}`;

const resolve = (resourceId: string) =>
  resolveNavigateFallbackUrl({ projectId: "proj_1", resourceId });

beforeEach(() => {
  vi.clearAllMocks();
  getProjectById.mockResolvedValue({ id: "proj_1", slug: "acme" });
});

describe("resolveNavigateFallbackUrl", () => {
  describe("given an id whose prefix names no resolvable resource", () => {
    it("returns null for an unknown prefix WITHOUT touching any service", async () => {
      // The prefix table is the whole allow-list: an id the table doesn't know
      // is never a target the fallback will invent, and it must short-circuit
      // before any tenancy-scoped lookup runs.
      expect(await resolve("session_0002Gu9QAAAABBBB")).toBeNull();
      expect(getScenarioRunData).not.toHaveBeenCalled();
      expect(getPromptByIdOrHandle).not.toHaveBeenCalled();
      expect(getProjectById).not.toHaveBeenCalled();
    });
  });

  describe("given a scenario-run id the project can see", () => {
    it("looks the run up with the project's own access and returns the platform-computed drawer url", async () => {
      getScenarioRunData.mockResolvedValue({ scenarioRunId: RUN_ID });

      expect(await resolve(RUN_ID)).toBe(DRAWER_URL);
      // Tenancy-scoped: the lookup is keyed by BOTH the project and the run,
      // never the run alone.
      expect(getScenarioRunData).toHaveBeenCalledWith({
        projectId: "proj_1",
        scenarioRunId: RUN_ID,
      });
    });
  });

  describe("given a prompt id the project can see", () => {
    /** @scenario "The platform fallback resolves every resource surface Langy opens" */
    it("resolves the prompts page with that prompt's editor drawer open: the reported chained-navigate case", async () => {
      getPromptByIdOrHandle.mockResolvedValue({ id: "prompt_abc" });

      expect(await resolve("prompt_abc")).toBe(
        "https://app.langwatch.ai/acme/prompts?drawer.open=promptEditor&drawer.promptId=prompt_abc",
      );
      expect(getPromptByIdOrHandle).toHaveBeenCalledWith({
        idOrHandle: "prompt_abc",
        projectId: "proj_1",
      });
    });

    it("returns null for a prompt the project cannot resolve", async () => {
      getPromptByIdOrHandle.mockResolvedValue(null);

      expect(await resolve("prompt_gone")).toBeNull();
      expect(getProjectById).not.toHaveBeenCalled();
    });
  });

  describe("given a dataset id the project can see", () => {
    it("resolves the dataset's own page", async () => {
      getDatasetBySlugOrId.mockResolvedValue({ id: "dataset_1" });

      expect(await resolve("dataset_1")).toBe(
        "https://app.langwatch.ai/acme/datasets/dataset_1",
      );
      expect(getDatasetBySlugOrId).toHaveBeenCalledWith({
        slugOrId: "dataset_1",
        projectId: "proj_1",
      });
    });

    it("returns null when the dataset lookup throws its not-found error", async () => {
      getDatasetBySlugOrId.mockRejectedValue(new Error("dataset_not_found"));

      expect(await resolve("dataset_gone")).toBeNull();
    });
  });

  describe("given a workflow id the project can see", () => {
    it("resolves the workflow's studio page from a project-scoped lookup", async () => {
      workflowFindFirst.mockResolvedValue({ id: "workflow_1" });

      expect(await resolve("workflow_1")).toBe(
        "https://app.langwatch.ai/acme/studio/workflow_1",
      );
      expect(workflowFindFirst).toHaveBeenCalledWith({
        where: { id: "workflow_1", projectId: "proj_1", archivedAt: null },
        select: { id: true },
      });
    });

    it("returns null when the workflow does not resolve in this project", async () => {
      workflowFindFirst.mockResolvedValue(null);

      expect(await resolve("workflow_gone")).toBeNull();
    });
  });

  describe("given an experiment id the project can see", () => {
    it("resolves the experiment's page by its slug: the address the app's own links use", async () => {
      findExperimentById.mockResolvedValue({
        id: "experiment_1",
        slug: "my-batch-eval",
      });

      expect(await resolve("experiment_1")).toBe(
        "https://app.langwatch.ai/acme/experiments/my-batch-eval",
      );
      expect(findExperimentById).toHaveBeenCalledWith({
        projectId: "proj_1",
        id: "experiment_1",
      });
    });

    it("returns null when the experiment does not resolve in this project", async () => {
      findExperimentById.mockResolvedValue(null);

      expect(await resolve("experiment_gone")).toBeNull();
    });
  });

  describe("given a monitor id the project can see", () => {
    it("resolves the online-evaluations page with that monitor's drawer open", async () => {
      monitorFindFirst.mockResolvedValue({ id: "monitor_1" });

      expect(await resolve("monitor_1")).toBe(
        "https://app.langwatch.ai/acme/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=monitor_1",
      );
      expect(monitorFindFirst).toHaveBeenCalledWith({
        where: { id: "monitor_1", projectId: "proj_1" },
        select: { id: true },
      });
    });

    it("returns null when the monitor does not resolve in this project", async () => {
      monitorFindFirst.mockResolvedValue(null);

      expect(await resolve("monitor_gone")).toBeNull();
    });
  });

  describe("given an evaluator id the project can see", () => {
    it("resolves the evaluators page with that evaluator's editor drawer open", async () => {
      getEvaluatorById.mockResolvedValue({ id: "evaluator_1" });

      expect(await resolve("evaluator_1")).toBe(
        "https://app.langwatch.ai/acme/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=evaluator_1",
      );
      expect(getEvaluatorById).toHaveBeenCalledWith({
        id: "evaluator_1",
        projectId: "proj_1",
      });
    });

    it("returns null when the evaluator does not resolve in this project", async () => {
      getEvaluatorById.mockResolvedValue(null);

      expect(await resolve("evaluator_gone")).toBeNull();
    });
  });

  describe("given an agent id the project can see", () => {
    it("resolves the http-agent editor drawer for an http agent", async () => {
      getAgentByIdOrThrow.mockResolvedValue({ id: "agent_1", type: "http" });

      expect(await resolve("agent_1")).toBe(
        "https://app.langwatch.ai/acme/agents?drawer.open=agentHttpEditor&drawer.agentId=agent_1",
      );
      expect(getAgentByIdOrThrow).toHaveBeenCalledWith({
        id: "agent_1",
        projectId: "proj_1",
      });
    });

    it("resolves the code editor drawer for any non-http agent: the REST API's own mapping", async () => {
      getAgentByIdOrThrow.mockResolvedValue({ id: "agent_2", type: "code" });

      expect(await resolve("agent_2")).toBe(
        "https://app.langwatch.ai/acme/agents?drawer.open=agentCodeEditor&drawer.agentId=agent_2",
      );
    });

    it("returns null when the agent lookup throws its not-found error", async () => {
      getAgentByIdOrThrow.mockRejectedValue(new Error("agent_not_found"));

      expect(await resolve("agent_gone")).toBeNull();
    });
  });

  describe("given the run does not resolve in this project", () => {
    /** @scenario "An id the project cannot resolve drops silently" */
    it("returns null when the run is not found, and never asks for the project", async () => {
      getScenarioRunData.mockResolvedValue(null);

      expect(await resolve(RUN_ID)).toBeNull();
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it("returns null (never throws) when the tenancy-scoped lookup errors", async () => {
      getScenarioRunData.mockRejectedValue(new Error("clickhouse down"));

      await expect(resolve(RUN_ID)).resolves.toBeNull();
    });
  });

  describe("given the resource resolves but the project cannot build an address", () => {
    it("returns null when the project has no slug", async () => {
      getScenarioRunData.mockResolvedValue({ scenarioRunId: RUN_ID });
      getProjectById.mockResolvedValue({ id: "proj_1", slug: undefined });

      expect(await resolve(RUN_ID)).toBeNull();
    });
  });
});
