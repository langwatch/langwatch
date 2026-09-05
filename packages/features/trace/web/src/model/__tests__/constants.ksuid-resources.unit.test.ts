/**
 * KSUID resource ID generation patterns for `KSUID_RESOURCES`.
 * @see specs/scenarios/scenario-job-id-uniqueness.feature
 */
import { generate } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";
import { KSUID_RESOURCES } from "../constants";

describe("KSUID resource patterns", () => {
  describe("SCENARIO resource", () => {
    const generateScenarioId = () => generate(KSUID_RESOURCES.SCENARIO).toString();

    /** @scenario New scenario ID uses "scenario_" prefix with KSUID */
    it("generates IDs with scenario_ prefix", () => {
      const id = generateScenarioId();
      expect(id).toMatch(/^scenario_/);
    });

    it("generates unique IDs on each call", () => {
      const id1 = generateScenarioId();
      const id2 = generateScenarioId();
      expect(id1).not.toBe(id2);
    });
  });
});
