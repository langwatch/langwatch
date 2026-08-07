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
    /** @scenario "A run plan keeps the bindings configured for its prompt" */
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

  describe("given an agent target carrying scenario mappings", () => {
    /** @scenario "An agent target cannot carry a prompt's bindings" */
    it.each([
      "http",
      "code",
      "workflow",
    ] as const)("rejects the mappings on a %s target", (type) => {
      const result = suiteTargetSchema.safeParse({
        type,
        referenceId: "agent_123",
        scenarioMappings: {
          question: { type: "source", sourceId: "scenario", path: ["input"] },
        },
      });

      // A run reads mappings from prompt targets only, so accepting these
      // would store a binding nothing ever applies.
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(["scenarioMappings"]);
      }
    });

    it("still accepts the same target without mappings", () => {
      const parsed = suiteTargetSchema.parse({
        type: "http",
        referenceId: "agent_123",
      });

      expect(parsed.scenarioMappings).toBeUndefined();
    });
  });
});
