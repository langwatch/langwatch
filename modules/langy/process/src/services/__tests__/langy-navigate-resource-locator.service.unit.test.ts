/**
 * The navigate fallback's resource half: an id is looked up in its owning
 * feature, with the asking project's own access.
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { AgentNotFoundError, type AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { ScenarioNotFoundError, type ScenarioApi } from "@langwatch/scenario-contract";
import { WorkflowNotFoundError, type WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  type LangyNavigateResourceLocation,
  LangyNavigateResourceLocatorService,
} from "../langy-navigate-resource-locator.service.ts";

const address = async (location: LangyNavigateResourceLocation) =>
  location.outcome === "located" ? location.address("acme") : location.outcome;

function locator(input: {
  experiments?: Partial<Pick<ExperimentApi, "findById">>;
  agents?: Partial<Pick<AgentApi, "getById" | "platformUrl">>;
  prompts?: Partial<Pick<PromptApi, "findByIdOrHandle">>;
  datasets?: Partial<Pick<DatasetApi, "findBySlugOrId">>;
  workflows?: Partial<Pick<WorkflowApi, "getById">>;
  monitors?: Partial<Pick<MonitorApi, "findById">>;
  evaluators?: Partial<Pick<EvaluatorApi, "findById">>;
  scenarios?: Partial<Pick<ScenarioApi, "getById" | "findScenarioRunData" | "platformUrl">>;
}) {
  return LangyNavigateResourceLocatorService.create({
    experiments: createApiFixture<ExperimentApi>(input.experiments ?? {}),
    agents: createApiFixture<AgentApi>(input.agents ?? {}),
    prompts: createApiFixture<PromptApi>(input.prompts ?? {}),
    datasets: createApiFixture<DatasetApi>(input.datasets ?? {}),
    workflows: createApiFixture<WorkflowApi>(input.workflows ?? {}),
    monitors: createApiFixture<MonitorApi>(input.monitors ?? {}),
    evaluators: createApiFixture<EvaluatorApi>(input.evaluators ?? {}),
    scenarios: createApiFixture<ScenarioApi>(input.scenarios ?? {}),
    publicBaseUrl: "https://app.langwatch.test",
  });
}

/** Every owner holds exactly the one resource each test asks for, under its own id. */
const scenarios = {
  getById: async ({ id }: { id: string }) =>
    createApiFixture<Awaited<ReturnType<ScenarioApi["getById"]>>>({ id }),
  findScenarioRunData: async ({ scenarioRunId }: { scenarioRunId: string }) =>
    createApiFixture<NonNullable<Awaited<ReturnType<ScenarioApi["findScenarioRunData"]>>>>({
      scenarioRunId,
    }),
  platformUrl: async ({ projectSlug, resource }: Parameters<ScenarioApi["platformUrl"]>[0]) =>
    "scenarioId" in resource
      ? `https://app.langwatch.test/${projectSlug}/simulations/scenarios/${resource.scenarioId}`
      : `https://app.langwatch.test/${projectSlug}/simulations/runs/${resource.scenarioRunId}`,
};

const everyOwner = locator({
  experiments: {
    findById: async ({ id }) =>
      createApiFixture<NonNullable<Awaited<ReturnType<ExperimentApi["findById"]>>>>({
        id,
        slug: "summer-eval",
      }),
  },
  agents: {
    getById: async ({ id }) =>
      createApiFixture<Awaited<ReturnType<AgentApi["getById"]>>>({ id, type: "http" }),
    platformUrl: ({ projectSlug, agentId, agentType }) =>
      `https://app.langwatch.test/${projectSlug}/agents#${agentType}:${agentId}`,
  },
  prompts: {
    findByIdOrHandle: async ({ idOrHandle }) =>
      createApiFixture<NonNullable<Awaited<ReturnType<PromptApi["findByIdOrHandle"]>>>>({
        id: idOrHandle,
      }),
  },
  datasets: {
    findBySlugOrId: async ({ slugOrId }) =>
      createApiFixture<NonNullable<Awaited<ReturnType<DatasetApi["findBySlugOrId"]>>>>({
        id: slugOrId,
      }),
  },
  workflows: {
    getById: async ({ id }) =>
      createApiFixture<Awaited<ReturnType<WorkflowApi["getById"]>>>({ id }),
  },
  monitors: {
    findById: async ({ id }) =>
      createApiFixture<NonNullable<Awaited<ReturnType<MonitorApi["findById"]>>>>({ id }),
  },
  evaluators: {
    findById: async ({ id }) =>
      createApiFixture<NonNullable<Awaited<ReturnType<EvaluatorApi["findById"]>>>>({ id }),
  },
  scenarios,
});

describe("LangyNavigateResourceLocatorService", () => {
  describe("when the id names an agent", () => {
    it("opens the agent at the address the agent module hands out", async () => {
      const agents = {
        getById: async ({ id }: { id: string }) =>
          createApiFixture<Awaited<ReturnType<AgentApi["getById"]>>>({ id, type: "http" }),
        platformUrl: ({
          projectSlug,
          agentId,
          agentType,
        }: Parameters<AgentApi["platformUrl"]>[0]) =>
          `https://app.langwatch.test/${projectSlug}/agents#${agentType}:${agentId}`,
      };

      expect(
        await address(
          await locator({ agents }).locate({
            projectId: "project-1",
            kind: "agent",
            resourceId: "agent_1",
          }),
        ),
      ).toBe("https://app.langwatch.test/acme/agents#http:agent_1");
    });

    it("answers unknown when the project holds no such agent", async () => {
      const agents = {
        getById: () => Promise.reject(new AgentNotFoundError("agent_gone", "project-1")),
      };

      expect(
        await locator({ agents }).locate({
          projectId: "project-1",
          kind: "agent",
          resourceId: "agent_gone",
        }),
      ).toEqual({ outcome: "unknown" });
    });
  });

  describe("when the id names an experiment", () => {
    it("answers unknown when the project holds no such experiment", async () => {
      expect(
        await locator({ experiments: { findById: async () => null } }).locate({
          projectId: "project-1",
          kind: "experiment",
          resourceId: "experiment_gone",
        }),
      ).toEqual({ outcome: "unknown" });
    });
  });

  describe("when the id names a resource the project holds", () => {
    /** @scenario The platform fallback resolves every resource surface Langy opens */
    it("opens each kind at the address the product's own links use", async () => {
      const opened = async (
        kind: Parameters<LangyNavigateResourceLocatorService["locate"]>[0]["kind"],
        resourceId: string,
      ) => address(await everyOwner.locate({ projectId: "project-1", kind, resourceId }));

      expect({
        prompt: await opened("prompt", "prompt_1"),
        dataset: await opened("dataset", "dataset_1"),
        workflow: await opened("workflow", "workflow_1"),
        experiment: await opened("experiment", "experiment_1"),
        monitor: await opened("monitor", "monitor_1"),
        evaluator: await opened("evaluator", "evaluator_1"),
        agent: await opened("agent", "agent_1"),
      }).toEqual({
        prompt: "https://app.langwatch.test/acme/prompts?promptId=prompt_1",
        dataset: "https://app.langwatch.test/acme/datasets/dataset_1",
        workflow: "https://app.langwatch.test/acme/studio/workflow_1",
        experiment: "https://app.langwatch.test/acme/experiments/summer-eval",
        monitor:
          "https://app.langwatch.test/acme/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=monitor_1",
        evaluator:
          "https://app.langwatch.test/acme/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=evaluator_1",
        agent: "https://app.langwatch.test/acme/agents#http:agent_1",
      });
    });

    /** @scenario A prompt opens in the playground, ready to run */
    it("opens a prompt as a playground tab rather than a drawer", async () => {
      expect(
        await address(
          await everyOwner.locate({
            projectId: "project-1",
            kind: "prompt",
            resourceId: "prompt_1",
          }),
        ),
      ).toBe("https://app.langwatch.test/acme/prompts?promptId=prompt_1");
    });

    /** @scenario A scenario opens in its editor through the platform fallback */
    it("opens a scenario at the address the scenario module hands out", async () => {
      expect(
        await address(
          await everyOwner.locate({
            projectId: "project-1",
            kind: "scenario",
            resourceId: "scenario_1",
          }),
        ),
      ).toBe("https://app.langwatch.test/acme/simulations/scenarios/scenario_1");
    });

    it("opens a scenario run at the address the scenario module hands out", async () => {
      expect(
        await address(
          await everyOwner.locate({
            projectId: "project-1",
            kind: "scenarioRun",
            resourceId: "scenariorun_1",
          }),
        ),
      ).toBe("https://app.langwatch.test/acme/simulations/runs/scenariorun_1");
    });
  });

  describe("when the project holds no such resource", () => {
    it("answers unknown for every kind whose owner finds nothing", async () => {
      const nothing = locator({
        prompts: { findByIdOrHandle: async () => null },
        datasets: { findBySlugOrId: async () => null },
        workflows: {
          getById: () => Promise.reject(new WorkflowNotFoundError("workflow_gone", "project-1")),
        },
        monitors: { findById: async () => undefined },
        evaluators: { findById: async () => undefined },
        scenarios: {
          getById: () => Promise.reject(new ScenarioNotFoundError("scenario_gone")),
          findScenarioRunData: async () => null,
        },
      });
      const kinds = [
        "prompt",
        "dataset",
        "workflow",
        "monitor",
        "evaluator",
        "scenario",
        "scenarioRun",
      ] as const;

      const outcomes = await Promise.all(
        kinds.map((kind) =>
          nothing.locate({ projectId: "project-1", kind, resourceId: `${kind}_gone` }),
        ),
      );

      expect(outcomes).toEqual(kinds.map(() => ({ outcome: "unknown" })));
    });

    it("lets a lookup failure that is not a miss through", async () => {
      const failing = locator({
        workflows: { getById: () => Promise.reject(new Error("database down")) },
      });

      await expect(
        failing.locate({ projectId: "project-1", kind: "workflow", resourceId: "workflow_1" }),
      ).rejects.toThrow("database down");
    });
  });
});
