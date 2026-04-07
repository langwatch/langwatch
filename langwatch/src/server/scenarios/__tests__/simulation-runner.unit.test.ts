/**
 * @vitest-environment node
 *
 * Unit tests for KSUID resource ID generation patterns.
 *
 * @see specs/scenarios/scenario-job-id-uniqueness.feature
 */

import { describe, expect, it } from "vitest";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

// Test KSUID generation patterns directly
describe("KSUID resource patterns", () => {
  describe("SCENARIO_BATCH resource", () => {
    const generateBatchRunId = () =>
      generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();

    it("generates IDs with scenariobatch_ prefix", () => {
      const id = generateBatchRunId();
      expect(id).toMatch(/^scenariobatch_/);
    });

    it("generates unique IDs on each call", () => {
      const id1 = generateBatchRunId();
      const id2 = generateBatchRunId();
      expect(id1).not.toBe(id2);
    });

    it("generates IDs with expected KSUID format", () => {
      const id = generateBatchRunId();
      // KSUID format: {resource}_{base62-encoded-ksuid}
      // Resource "scenariobatch" + "_" = 14 chars, KSUID payload is 29 chars = 43 total
      expect(id.length).toBe(43);
    });
  });

  describe("SCENARIO resource", () => {
    const generateScenarioId = () =>
      generate(KSUID_RESOURCES.SCENARIO).toString();

    it("generates IDs with scenario_ prefix", () => {
      const id = generateScenarioId();
      expect(id).toMatch(/^scenario_/);
    });

    it("generates unique IDs on each call", () => {
      const id1 = generateScenarioId();
      const id2 = generateScenarioId();
      expect(id1).not.toBe(id2);
    });

    it("generates IDs with expected KSUID format", () => {
      const id = generateScenarioId();
      // Resource "scenario" + "_" = 9 chars, KSUID payload is 29 chars = 38 total
      expect(id.length).toBe(38);
    });
  });

  describe("SCENARIO_RUN resource", () => {
    const generateScenarioRunId = () =>
      generate(KSUID_RESOURCES.SCENARIO_RUN).toString();

    it("generates IDs with scenariorun_ prefix", () => {
      const id = generateScenarioRunId();
      expect(id).toMatch(/^scenariorun_/);
    });

    it("generates unique IDs on each call", () => {
      const id1 = generateScenarioRunId();
      const id2 = generateScenarioRunId();
      expect(id1).not.toBe(id2);
    });

    it("generates IDs with expected KSUID format", () => {
      const id = generateScenarioRunId();
      // Resource "scenariorun" + "_" = 12 chars, KSUID payload is 29 chars = 41 total
      expect(id.length).toBe(41);
    });
  });
});

