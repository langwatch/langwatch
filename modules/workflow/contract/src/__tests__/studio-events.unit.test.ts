import { describe, expect, it } from "vitest";

import { studioClientEventSchema } from "../studio-events.ts";
import { studioOptimizerParamsSchema } from "../studio-optimization.ts";

const workflow = {
  workflow_id: "wf-1",
  spec_version: "1.5",
  name: "Test",
  icon: "x",
  description: "x",
  version: "1.0",
  nodes: [],
  edges: [],
  state: { execution: { status: "idle" } },
};

const optimizationEvent = (params: unknown) => ({
  type: "execute_optimization",
  payload: {
    run_id: "run_1",
    workflow,
    workflow_version_id: "v1",
    optimizer: "MIPROv2",
    params,
  },
});

describe("studioClientEventSchema", () => {
  describe("given an optimization event", () => {
    /** @scenario "Studio execution events use one portable wire contract" */
    it("validates its optimizer parameters against the shared optimizer shape", () => {
      const params = { num_candidates: 4, max_rounds: 2 };
      const parsed = studioClientEventSchema.parse(optimizationEvent(params));

      expect(parsed.type).toBe("execute_optimization");
      expect(studioOptimizerParamsSchema.parse(params)).toEqual(params);
    });

    /** @scenario "Studio execution events use one portable wire contract" */
    it("refuses optimizer parameters the shared shape rejects", () => {
      const bad = { num_candidates: "four" };

      expect(studioOptimizerParamsSchema.validate(bad)).toBe(false);
      expect(studioClientEventSchema.validate(optimizationEvent(bad))).toBe(false);
    });
  });

  describe("given the contract's schemas", () => {
    /** @scenario "Studio execution events use one portable wire contract" */
    it("are Zod 4 schemas", () => {
      expect("_zod" in studioClientEventSchema).toBe(true);
      expect("_zod" in studioOptimizerParamsSchema).toBe(true);
    });
  });
});
