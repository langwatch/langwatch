/**
 * @vitest-environment node
 *
 * The basic shape of suiteTargetSchema: which target types validate, and
 * that a suite target with no fieldMappings still parses.
 *
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
    it("validates successfully without fieldMappings", () => {
      const result = suiteTargetSchema.safeParse({
        type: "prompt",
        referenceId: "prompt_456",
      });

      expect(result.success).toBe(true);
    });
  });
});
