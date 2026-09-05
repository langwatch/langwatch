/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-input-mapping.feature
 */

import { describe, expect, it } from "vitest";
import { suiteTargetSchema } from "../suite";

describe("suiteTargetSchema", () => {
  describe("when type is code with a referenceId", () => {
    /** @scenario Suite target schema allows code agent type */
    it("validates successfully", () => {
      const result = suiteTargetSchema.safeParse({
        type: "code",
        referenceId: "agent_123",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("when only type and referenceId are provided", () => {
    /** @scenario Existing suites without fieldMappings parse successfully */
    /** @scenario Suite target schema ignores unknown fields for backwards compatibility */
    it("validates successfully without fieldMappings", () => {
      const result = suiteTargetSchema.safeParse({
        type: "prompt",
        referenceId: "prompt_456",
      });

      expect(result.success).toBe(true);
    });
  });
});
