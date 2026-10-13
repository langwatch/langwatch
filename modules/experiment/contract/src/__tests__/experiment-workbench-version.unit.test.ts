import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import type { PersistedEvaluationsV3State } from "../experiment-workbench-persistence.ts";
import {
  parseWorkbenchState,
  normalizeWorkbenchState,
  stripWorkbenchResults,
} from "../experiment-workbench-version.ts";

const state = (
  overrides: Partial<PersistedEvaluationsV3State> = {},
): PersistedEvaluationsV3State => ({
  name: "My evaluation",
  datasets: [
    {
      id: "dataset-1",
      name: "Inline",
      type: "inline",
      columns: [{ id: "input", name: "input", type: "string" }],
    },
  ],
  activeDatasetId: "dataset-1",
  evaluators: [],
  targets: [],
  ...overrides,
});

/** Runs `fn`, returning what it threw, or fails the test if it did not throw. */
function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected function to throw");
}

describe("Experiment workbench contract", () => {
  /** @scenario "A state that does not match the schema is refused" */
  it("reports invalid persisted state as the established handled error", () => {
    const error = thrownBy(() => parseWorkbenchState({ ...state(), activeDatasetId: 42 }));
    expect(HandledError.isHandled(error)).toBe(true);
    if (!HandledError.isHandled(error)) return;
    expect(error.code).toBe("experiment_invalid_workbench_state");
    expect(error.meta).toEqual({
      issues: [
        {
          path: "activeDatasetId",
          message: "Invalid input: expected string, received number",
        },
      ],
    });
  });

  it("refuses a comparison column on a non-comparison evaluator", () => {
    const invalid = state({
      evaluators: [
        {
          id: "evaluator-1",
          evaluatorType: "langevals/basic",
          inputs: [],
          mappings: {},
          comparison: {
            variants: [],
            hasGoldenAnswer: false,
            includeMetrics: [],
            randomizeOrder: true,
          },
        },
      ],
    });

    const error = thrownBy(() => parseWorkbenchState(invalid));
    expect(HandledError.isHandled(error)).toBe(true);
    if (!HandledError.isHandled(error)) return;
    expect(error.code).toBe("experiment_invalid_workbench_state");
    expect(error.meta).toMatchObject({
      issues: [
        {
          path: "evaluators.0.comparison",
        },
      ],
    });
  });

  it("repairs a legacy pairwise evaluator without touching live results", () => {
    const repaired = normalizeWorkbenchState(
      state({
        evaluators: [
          {
            id: "evaluator-1",
            evaluatorType: "langevals/pairwise_compare",
            inputs: [],
            mappings: {},
            pairwise: {
              variantA: "target-a",
              variantB: "target-b",
              goldenField: "expected_output",
              hasGoldenAnswer: true,
              includeMetrics: [],
            },
          },
        ],
        results: {
          targetOutputs: { "target-a": ["answer"] },
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      }),
    );

    expect(repaired?.evaluators[0]).toMatchObject({
      comparison: {
        variants: ["target-a", "target-b"],
        goldenField: "expected_output",
        randomizeOrder: true,
      },
    });
    expect(repaired?.evaluators[0]).not.toHaveProperty("pairwise");
    expect(repaired?.results).toEqual({
      targetOutputs: { "target-a": ["answer"] },
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    });
  });

  /** @scenario "Run results are not stored in the version snapshot" */
  it("strips results only from a version snapshot", () => {
    const snapshot = stripWorkbenchResults(
      state({
        results: {
          targetOutputs: { "target-a": ["answer"] },
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      }),
    );

    expect(snapshot.results).toBeUndefined();
    expect(snapshot.name).toBe("My evaluation");
  });
});
