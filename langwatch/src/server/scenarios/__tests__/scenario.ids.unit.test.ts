import { describe, it, expect } from "vitest";
import { generateScenarioRunId, generateBatchRunId } from "../scenario.ids";

describe("generateScenarioRunId()", () => {
  /** @scenario 'Synthetic scenario run ID uses "scenariorun_" prefix with KSUID' */
  it("returns an id with the 'scenariorun_' prefix and a KSUID suffix", () => {
    const id = generateScenarioRunId();

    expect(id).toMatch(/^scenariorun_[A-Za-z0-9]+$/);

    const suffix = id.slice("scenariorun_".length);
    expect(suffix.length).toBeGreaterThanOrEqual(20);
  });

  it("produces a different id on each call", () => {
    const a = generateScenarioRunId();
    const b = generateScenarioRunId();
    expect(a).not.toBe(b);
  });
});

describe("generateBatchRunId()", () => {
  it("returns an id with the 'scenariobatch_' prefix and a KSUID suffix", () => {
    const id = generateBatchRunId();

    expect(id).toMatch(/^scenariobatch_[A-Za-z0-9]+$/);
  });
});
