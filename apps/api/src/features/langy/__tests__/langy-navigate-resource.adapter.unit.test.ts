/**
 * Where each resource Langy can open is read, and the address the reader lands
 * on (specs/langy/langy-agent-driven-navigation.feature).
 */
import type { LangyNavigateResourceKind } from "@langwatch/langy-server";
import { describe, expect, it, vi } from "vitest";

import {
  ApiLangyNavigateResourceAdapter,
  type ApiLangyNavigateResources,
} from "../langy-navigate-resource.adapter.ts";

/**
 * Every directory answers with the row it was asked for, so one table can say
 * both what was looked up and where the reader lands.
 */
function directories(): {
  services: ApiLangyNavigateResources;
  calls: Record<string, unknown>;
} {
  const calls: Record<string, unknown> = {};
  const record =
    <T>(name: string, row: T) =>
    async (input: unknown) => {
      calls[name] = input;
      return row;
    };
  return {
    calls,
    services: {
      prompts: { tryGetPromptByIdOrHandle: record("prompt", { id: "prompt_abc" }) },
      datasets: { getBySlugOrId: record("dataset", { id: "dataset_1" }) },
      workflows: { getById: record("workflow", { id: "workflow_1" }) },
      experiments: {
        tryGetById: record("experiment", { id: "experiment_1", slug: "my-batch-eval" }),
      },
      monitors: { tryGetMonitorById: record("monitor", { id: "monitor_1" }) },
      evaluators: { tryGetById: record("evaluator", { id: "evaluator_1" }) },
      agents: { getById: record("agent", { id: "agent_1", type: "http" }) },
      simulations: { tryGetScenarioRunData: record("scenarioRun", { scenarioRunId: "run_1" }) },
    } as unknown as ApiLangyNavigateResources,
  };
}

const locate =
  (services: ApiLangyNavigateResources) => (kind: LangyNavigateResourceKind, resourceId: string) =>
    ApiLangyNavigateResourceAdapter.create(() => services).tryLocate({
      projectId: "project-1",
      kind,
      resourceId,
    });

describe("ApiLangyNavigateResourceAdapter", () => {
  describe("when the agent opens a resource the project can see", () => {
    /** @scenario The platform fallback resolves every resource surface Langy opens */
    it("answers each surface with the address that resource's own links use", async () => {
      const { services, calls } = directories();
      const at = locate(services);

      expect(await at("prompt", "prompt_abc")).toBe("/prompts?promptId=prompt_abc");
      expect(await at("dataset", "dataset_1")).toBe("/datasets/dataset_1");
      expect(await at("workflow", "workflow_1")).toBe("/studio/workflow_1");
      // The experiment page resolves slug or id; the slug is what the app's own
      // links use.
      expect(await at("experiment", "experiment_1")).toBe("/experiments/my-batch-eval");
      expect(await at("monitor", "monitor_1")).toBe(
        "/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=monitor_1",
      );
      expect(await at("evaluator", "evaluator_1")).toBe(
        "/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=evaluator_1",
      );
      expect(await at("agent", "agent_1")).toBe(
        "/agents?drawer.open=agentHttpEditor&drawer.agentId=agent_1",
      );
      expect(await at("scenarioRun", "scenariorun_1")).toBe(
        "/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=scenariorun_1",
      );

      // Every lookup is tenancy-scoped: the project is always in it, never the
      // id alone.
      for (const input of Object.values(calls)) {
        expect(input).toMatchObject({ projectId: "project-1" });
      }
    });

    /** @scenario A prompt opens in the playground, ready to run */
    it("opens a prompt as a playground tab rather than an editor drawer", async () => {
      const { services } = directories();

      expect(await locate(services)("prompt", "prompt_abc")).toBe("/prompts?promptId=prompt_abc");
    });
  });

  describe("when the resource does not resolve in this project", () => {
    it("answers null so the navigate drops", async () => {
      const services = {
        prompts: { tryGetPromptByIdOrHandle: vi.fn(async () => null) },
      } as unknown as ApiLangyNavigateResources;

      expect(await locate(services)("prompt", "prompt_gone")).toBeNull();
    });
  });

  describe("when this process composed none of the feature that owns the id", () => {
    it("answers null rather than inventing an address", async () => {
      expect(await locate({})("dataset", "dataset_1")).toBeNull();
    });
  });
});
