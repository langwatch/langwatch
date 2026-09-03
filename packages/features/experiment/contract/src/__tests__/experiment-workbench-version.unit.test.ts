import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  parseWorkbenchState,
  repairWorkbenchState,
  stripWorkbenchResults,
} from "../experiment-workbench-version";
import type { PersistedEvaluationsV3State } from "../experiment-workbench-persistence";

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

describe("Experiment workbench contract", () => {
  /** @scenario "A state that does not match the schema is refused" */
  it("reports invalid persisted state as the established handled error", () => {
    try {
      parseWorkbenchState({ ...state(), activeDatasetId: 42 });
      expect.unreachable("the invalid state should be rejected");
    } catch (error) {
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
    }
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

    try {
      parseWorkbenchState(invalid);
      expect.unreachable("the comparison invariant should be rejected");
    } catch (error) {
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
    }
  });

  it("repairs a legacy pairwise evaluator without touching live results", () => {
    const repaired = repairWorkbenchState(
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
