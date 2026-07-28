import { describe, it, expect } from "vitest";
import {
  deriveBatchRunId,
  deriveScenarioRunId,
  generateScenarioRunId,
  generateBatchRunId,
} from "../scenario.ids";

describe("generateScenarioRunId()", () => {
  /** @scenario 'Synthetic scenario run ID uses "scenariorun_" prefix with KSUID' */
  it("returns an id with the 'scenariorun_' prefix and a KSUID suffix", () => {
    const id = generateScenarioRunId();

    expect(id).toMatch(/^scenariorun_[A-Za-z0-9]{29}$/);
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

    expect(id).toMatch(/^scenariobatch_[A-Za-z0-9]{29}$/);
  });
});

describe("deriveScenarioRunId()", () => {
  const base = {
    projectId: "proj_1",
    idempotencyKey: "key-a",
    scenarioId: "scenario_1",
    targetReferenceId: "target_1",
    repeat: 0,
  };

  /** @scenario "Resubmitting a suite with the same key does not queue it twice" */
  it("returns the same id for the same submit", () => {
    expect(deriveScenarioRunId(base)).toBe(deriveScenarioRunId(base));
  });

  it("is indistinguishable in shape from a generated id", () => {
    // Consumers compare run ids exactly and never decode them, but the shape
    // still has to match or anything asserting on it starts failing.
    expect(deriveScenarioRunId(base)).toMatch(/^scenariorun_[A-Za-z0-9]{29}$/);
  });

  describe("when one field of the submit differs", () => {
    it.each([
      ["idempotency key", { idempotencyKey: "key-b" }],
      ["scenario", { scenarioId: "scenario_2" }],
      ["target", { targetReferenceId: "target_2" }],
      ["repeat index", { repeat: 1 }],
    ] as const)("gives a different run id for a different %s", (_label, patch) => {
      expect(deriveScenarioRunId({ ...base, ...patch })).not.toBe(
        deriveScenarioRunId(base),
      );
    });
  });

  describe("given two different projects", () => {
    /** @scenario "Two projects reusing one key do not collide" */
    it("never derives the same run id, even for an identical submit", () => {
      // Two tenants can pick the same idempotency key. Their runs must not
      // collide onto one aggregate.
      expect(deriveScenarioRunId({ ...base, projectId: "proj_2" })).not.toBe(
        deriveScenarioRunId(base),
      );
    });
  });

  describe("given field values that concatenate to the same string", () => {
    it("still derives different ids", () => {
      // "a" + "bc" and "ab" + "c" must not hash alike, or a scenario id
      // ending in a digit could collide with a neighbouring repeat index.
      const left = deriveScenarioRunId({
        ...base,
        scenarioId: "a",
        targetReferenceId: "bc",
      });
      const right = deriveScenarioRunId({
        ...base,
        scenarioId: "ab",
        targetReferenceId: "c",
      });

      expect(left).not.toBe(right);
    });
  });
});

describe("deriveBatchRunId()", () => {
  const base = {
    projectId: "proj_1",
    suiteId: "suite_1",
    idempotencyKey: "key-a",
  };

  it("returns the same batch for the same submit", () => {
    expect(deriveBatchRunId(base)).toBe(deriveBatchRunId(base));
  });

  it("is indistinguishable in shape from a generated id", () => {
    expect(deriveBatchRunId(base)).toMatch(/^scenariobatch_[A-Za-z0-9]{29}$/);
  });

  it("gives a different batch for a different key", () => {
    expect(deriveBatchRunId({ ...base, idempotencyKey: "key-b" })).not.toBe(
      deriveBatchRunId(base),
    );
  });

  it("gives a different batch for a different suite", () => {
    expect(deriveBatchRunId({ ...base, suiteId: "suite_2" })).not.toBe(
      deriveBatchRunId(base),
    );
  });
});
