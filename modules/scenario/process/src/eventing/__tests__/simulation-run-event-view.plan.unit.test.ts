import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { buildSimulationRunEventView } from "../simulation-run-execution-evolution.process.ts";

const queued = (data: Record<string, unknown>) =>
  buildSimulationRunEventView({
    type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
    occurredAt: 1_000,
    data,
  } as never);

/** Cut S2: a suite pins its plan's models and its prompt target's mappings on the run it queues. */
describe("buildSimulationRunEventView", () => {
  describe("given a run a suite queued with plan models and prompt mappings", () => {
    it("carries the plan's models and the target's mappings to execution", () => {
      const view = queued({
        scenarioSetId: "__internal__suite_1__suite",
        target: {
          type: "prompt",
          referenceId: "prompt_1",
          scenarioMappings: { input: { type: "value", value: "hello" } },
        },
        metadata: { langwatch: { simulatorModel: "openai/gpt-5", actorId: "user_1" } },
      });

      expect(view.plan).toEqual({ simulatorModel: "openai/gpt-5" });
      expect(view.target).toEqual({
        type: "prompt",
        referenceId: "prompt_1",
        scenarioMappings: { input: { type: "value", value: "hello" } },
      });
    });
  });

  describe("given a run queued before the suite pinned either", () => {
    it("reads no plan and a target without mappings", () => {
      const view = queued({ target: { type: "http", referenceId: "agent_1" }, metadata: {} });

      expect(view.plan).toEqual({});
      expect(view.target).toEqual({ type: "http", referenceId: "agent_1" });
    });
  });
});
