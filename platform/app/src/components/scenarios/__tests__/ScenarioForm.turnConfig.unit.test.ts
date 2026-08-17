/**
 * @vitest-environment node
 *
 * Form schema validation for maxTurns / minTurns fields.
 *
 * @see specs/scenarios/scenario-editor.feature (Turn Configuration ADR-015)
 * @see docs/adr/015-scenario-turn-config-ui.md
 */
import { describe, expect, it } from "vitest";
import { scenarioFormSchema } from "../ScenarioForm";

describe("scenarioFormSchema turn config", () => {
  const base = {
    name: "Test scenario",
    situation: "User asks",
    criteria: ["polite"],
    labels: [],
    parameters: [],
  };

  it("accepts maxTurns as a positive integer", () => {
    const result = scenarioFormSchema.safeParse({ ...base, maxTurns: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxTurns).toBe(5);
    }
  });

  it("accepts minTurns as a non-negative integer", () => {
    const result = scenarioFormSchema.safeParse({ ...base, minTurns: 3 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minTurns).toBe(3);
    }
  });

  /** @scenario "maxTurns rejects non-positive values" */
  it("rejects maxTurns = 0", () => {
    const result = scenarioFormSchema.safeParse({ ...base, maxTurns: 0 });
    expect(result.success).toBe(false);
  });

  /** @scenario "minTurns rejects negative values" */
  it("rejects negative minTurns", () => {
    const result = scenarioFormSchema.safeParse({ ...base, minTurns: -1 });
    expect(result.success).toBe(false);
  });

  /** @scenario "maxTurns rejects decimal values" */
  it("rejects decimal maxTurns", () => {
    const result = scenarioFormSchema.safeParse({ ...base, maxTurns: 2.5 });
    expect(result.success).toBe(false);
  });

  it("allows omitting both fields (backward compat)", () => {
    const result = scenarioFormSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxTurns).toBeUndefined();
      expect(result.data.minTurns).toBeUndefined();
    }
  });

  it("allows null maxTurns (cleared field)", () => {
    const result = scenarioFormSchema.safeParse({ ...base, maxTurns: null });
    expect(result.success).toBe(true);
  });

  it("allows null minTurns (cleared field)", () => {
    const result = scenarioFormSchema.safeParse({ ...base, minTurns: null });
    expect(result.success).toBe(true);
  });
});
