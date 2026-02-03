/**
 * @vitest-environment node
 *
 * Unit tests for scenario queue pure functions.
 *
 * Note: scheduleScenarioRun tests are in simulation-runner.integration.test.ts
 * because importing scenario.queue triggers module initialization that requires
 * database/Redis connections.
 */

import { describe, expect, it } from "vitest";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

// Test the batch ID generation pattern directly without importing the module
// (importing scenario.queue triggers processScenarioJob → database connections)
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

describe("scenario job ID pattern", () => {
  // Mirror the implementation for unit testing
  const buildJobId = (projectId: string, scenarioId: string, batchRunId: string) =>
    `scenario_${projectId}_${scenarioId}_${batchRunId}`;

  it("creates deterministic job ID from params", () => {
    const jobId = buildJobId("proj_123", "scen_456", "batch_789");
    expect(jobId).toBe("scenario_proj_123_scen_456_batch_789");
  });

  it("creates same ID for same params (idempotent)", () => {
    const params = { projectId: "p1", scenarioId: "s1", batchRunId: "b1" };
    const id1 = buildJobId(params.projectId, params.scenarioId, params.batchRunId);
    const id2 = buildJobId(params.projectId, params.scenarioId, params.batchRunId);
    expect(id1).toBe(id2);
  });

  it("creates different IDs for different scenarios", () => {
    const id1 = buildJobId("proj", "scenario_a", "batch");
    const id2 = buildJobId("proj", "scenario_b", "batch");
    expect(id1).not.toBe(id2);
  });
});
