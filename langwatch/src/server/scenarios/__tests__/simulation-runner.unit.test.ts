/**
 * @vitest-environment node
 *
 * Unit tests for scenario queue pure functions.
 *
 * Note: scheduleScenarioRun tests are in simulation-runner.integration.test.ts
 * because importing scenario.queue triggers module initialization that requires
 * database/Redis connections.
 *
 * @see specs/scenarios/scenario-job-id-uniqueness.feature
 */

import { describe, expect, it } from "vitest";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";
import { buildScenarioJobId } from "../scenario.queue.jobId";

// Test the batch ID generation pattern directly without importing the module
// (importing scenario.queue triggers processScenarioJob -> database connections)
describe("generateBatchRunId pattern", () => {
  // Mirror the implementation for unit testing
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

describe("buildScenarioJobId()", () => {
  describe("given a single target", () => {
    it("creates deterministic job ID from params", () => {
      const jobId = buildScenarioJobId({
        projectId: "proj_123",
        scenarioId: "scen_456",
        targetReferenceId: "prompt_A",
        batchRunId: "batch_789",
        index: 0,
      });
      expect(jobId).toBe(
        "scenario_proj_123_scen_456_prompt_A_batch_789_0",
      );
    });

    it("creates same ID for same params (idempotent)", () => {
      const params = {
        projectId: "p1",
        scenarioId: "s1",
        targetReferenceId: "prompt_A",
        batchRunId: "b1",
        index: 0,
      };
      const id1 = buildScenarioJobId(params);
      const id2 = buildScenarioJobId(params);
      expect(id1).toBe(id2);
    });

    it("creates different IDs for different scenarios", () => {
      const id1 = buildScenarioJobId({
        projectId: "proj",
        scenarioId: "scenario_a",
        targetReferenceId: "prompt_A",
        batchRunId: "batch",
        index: 0,
      });
      const id2 = buildScenarioJobId({
        projectId: "proj",
        scenarioId: "scenario_b",
        targetReferenceId: "prompt_A",
        batchRunId: "batch",
        index: 0,
      });
      expect(id1).not.toBe(id2);
    });
  });

  // @see specs/scenarios/scenario-job-id-uniqueness.feature
  // Scenario: Scheduling same scenario against two different targets produces distinct job IDs
  describe("when scheduling against two different targets", () => {
    it("produces distinct job IDs", () => {
      const idA = buildScenarioJobId({
        projectId: "proj_1",
        scenarioId: "refund_flow",
        targetReferenceId: "prompt_A",
        batchRunId: "batch_1",
        index: 0,
      });
      const idB = buildScenarioJobId({
        projectId: "proj_1",
        scenarioId: "refund_flow",
        targetReferenceId: "prompt_B",
        batchRunId: "batch_1",
        index: 0,
      });
      expect(idA).not.toBe(idB);
    });
  });

  // Scenario: Job ID includes target reference ID
  describe("when scheduled against a target", () => {
    it("includes the target reference ID in the job ID", () => {
      const jobId = buildScenarioJobId({
        projectId: "proj_1",
        scenarioId: "refund_flow",
        targetReferenceId: "prompt_A",
        batchRunId: "batch_1",
        index: 0,
      });
      expect(jobId).toContain("prompt_A");
    });
  });

  // Scenario: Scheduling same scenario three times in one batch produces three distinct job IDs
  describe("when scheduling same scenario 3 times in one batch", () => {
    it("produces three distinct job IDs", () => {
      const ids = [0, 1, 2].map((index) =>
        buildScenarioJobId({
          projectId: "proj_1",
          scenarioId: "refund_flow",
          targetReferenceId: "prompt_A",
          batchRunId: "batch_1",
          index,
        }),
      );
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  // Scenario: Running scenario against two targets with repeat=2 produces four distinct jobs
  describe("when running against two targets with 2 repeats each", () => {
    it("produces 4 unique job IDs", () => {
      const targets = ["prompt_A", "prompt_B"];
      const repeats = 2;
      const ids: string[] = [];

      let index = 0;
      for (const target of targets) {
        for (let r = 0; r < repeats; r++) {
          ids.push(
            buildScenarioJobId({
              projectId: "proj_1",
              scenarioId: "refund_flow",
              targetReferenceId: target,
              batchRunId: "batch_1",
              index,
            }),
          );
          index++;
        }
      }

      expect(ids).toHaveLength(4);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(4);
    });
  });
});
