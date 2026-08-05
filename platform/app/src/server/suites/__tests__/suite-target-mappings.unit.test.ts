/**
 * @vitest-environment node
 *
 * Covers the suite-target side of specs/scenarios/scenario-input-mapping.feature:
 * a prompt is authored in the prompt library and pointed at, so the binding
 * between a simulation and the prompt's declared inputs lives on the suite
 * target that made the pairing (#6590).
 */

import { describe, expect, it } from "vitest";
import { suiteTargetSchema } from "../types";

describe("suiteTargetSchema", () => {
  describe("given a prompt target carrying scenario mappings", () => {
    /** @scenario "Prompt targets carry their mappings on the suite target" */
    it("preserves the scenarioMappings through validation", () => {
      const parsed = suiteTargetSchema.parse({
        type: "prompt",
        referenceId: "prompt_123",
        scenarioMappings: {
          question: { type: "source", sourceId: "scenario", path: ["input"] },
          tier: { type: "value", value: "gold" },
        },
      });

      expect(parsed.scenarioMappings).toEqual({
        question: { type: "source", sourceId: "scenario", path: ["input"] },
        tier: { type: "value", value: "gold" },
      });
    });

    it("accepts a target that carries no mappings", () => {
      const parsed = suiteTargetSchema.parse({
        type: "prompt",
        referenceId: "prompt_123",
      });

      expect(parsed.scenarioMappings).toBeUndefined();
    });
  });
});
