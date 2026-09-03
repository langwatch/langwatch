/**
 * @see specs/experiments-v3/workbench-actions.feature
 */
import { describe, expect, it } from "vitest";
import { COMPARISON_EVALUATOR_TYPE, type EvaluatorConfig } from "../../types";
import { addEvaluator, attachEvaluator } from "../transforms";
import { baseState, refusalCode } from "./workbench-fixtures";

const comparisonConfig = {
  variants: ["target-a", "target-b"],
  hasGoldenAnswer: true,
  goldenField: "expected_output",
  includeMetrics: [] as ("cost" | "duration")[],
  randomizeOrder: true,
};

/** The zod message the schema reported for a field, or "" when it accepted it. */
const schemaIssueFor = (run: () => unknown, field: string): string => {
  try {
    run();
  } catch (error) {
    const issues = (
      error as { issues?: { path: unknown[]; message: string }[] }
    ).issues;
    return issues?.find((issue) => issue.path[0] === field)?.message ?? "";
  }
  return "";
};

describe("addEvaluator", () => {
  it("auto-maps across datasets and targets", () => {
    const { state, result } = addEvaluator({
      state: baseState(),
      payload: {
        evaluatorType: "langevals/exact_match",
        name: "scored",
        dbEvaluatorId: "db-evaluator-3",
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
      },
    });

    const added = state.evaluators[1]!;
    expect(added.id).toBe(result?.evaluatorId);
    expect(added.mappings["ds-1"]!["target-a"]).toEqual({
      output: {
        type: "source",
        source: "target",
        sourceId: "target-a",
        sourceField: "output",
      },
      expected_output: {
        type: "source",
        source: "dataset",
        sourceId: "ds-1",
        sourceField: "expected_output",
      },
    });
  });

  it("keeps mappings given on the payload", () => {
    const { state } = addEvaluator({
      state: baseState(),
      payload: {
        id: "evaluator_fixed",
        evaluatorType: "langevals/exact_match",
        name: "scored",
        inputs: [{ identifier: "output", type: "str" }],
        mappings: {
          "ds-1": {
            "target-a": { output: { type: "value", value: "fixed" } },
          },
        },
      },
    });

    expect(state.evaluators[1]!.mappings["ds-1"]!["target-a"]!.output).toEqual({
      type: "value",
      value: "fixed",
    });
  });

  describe("when the payload names an id the workbench already holds", () => {
    /** @scenario "An id the workbench already holds is refused" */
    it("refuses with evaluator_already_exists", () => {
      expect(
        refusalCode(() =>
          addEvaluator({
            state: baseState(),
            payload: {
              id: "evaluator_1",
              evaluatorType: "langevals/exact_match",
              name: "scored",
              inputs: [],
            },
          }),
        ),
      ).toBe("evaluator_already_exists");
    });

    /** @scenario "An id the workbench already holds is refused" */
    it("leaves the workbench with the one evaluator it had", () => {
      const state = baseState();

      refusalCode(() =>
        addEvaluator({
          state,
          payload: {
            id: "evaluator_1",
            evaluatorType: "langevals/exact_match",
            name: "scored",
            inputs: [],
          },
        }),
      );

      expect(state.evaluators.map((e) => e.id)).toEqual(["evaluator_1"]);
    });
  });

  describe("when the payload names a blank id", () => {
    it("rejects it rather than adding an evaluator no score can name", () => {
      expect(() =>
        addEvaluator({
          state: baseState(),
          payload: {
            id: "",
            evaluatorType: "langevals/exact_match",
            name: "scored",
            inputs: [],
          },
        }),
      ).toThrow();
    });
  });

  describe("when the payload gives a comparison config to a plain evaluator", () => {
    const addPlainComparison = () =>
      addEvaluator({
        state: baseState(),
        payload: {
          evaluatorType: "langevals/exact_match",
          name: "scored",
          inputs: [],
          comparison: comparisonConfig,
        },
      });

    /** @scenario "Only the comparison judge can be a standalone comparison column" */
    it("names the one evaluator that can be a standalone comparison column", () => {
      expect(schemaIssueFor(addPlainComparison, "comparison")).toContain(
        `Only the Comparison judge (${COMPARISON_EVALUATOR_TYPE}) can be a standalone comparison column.`,
      );
    });

    /** @scenario "Only the comparison judge can be a standalone comparison column" */
    it("says what to send instead", () => {
      expect(schemaIssueFor(addPlainComparison, "comparison")).toContain(
        'Omit "comparison" and this evaluator attaches to every target column as a score.',
      );
    });

    /** @scenario "Only the comparison judge can be a standalone comparison column" */
    it("leaves the workbench with the one evaluator it had", () => {
      const state = baseState();

      try {
        addEvaluator({
          state,
          payload: {
            evaluatorType: "langevals/exact_match",
            name: "scored",
            inputs: [],
            comparison: comparisonConfig,
          },
        });
      } catch {
        // the refusal is what is under test above
      }

      expect(state.evaluators.map((e) => e.id)).toEqual(["evaluator_1"]);
    });
  });

  describe("when the payload gives a comparison config to the comparison judge", () => {
    it("adds the standalone comparison column", () => {
      const { state } = addEvaluator({
        state: baseState(),
        payload: {
          evaluatorType: COMPARISON_EVALUATOR_TYPE,
          name: "scored",
          inputs: [],
          comparison: comparisonConfig,
        },
      });

      expect(state.evaluators[1]?.comparison?.variants).toEqual([
        "target-a",
        "target-b",
      ]);
    });
  });

  describe("when the payload names an evaluator type no evaluator has", () => {
    /** @scenario "An evaluator names a type that exists" */
    it("says how to list the types the workbench accepts", () => {
      const message = schemaIssueFor(
        () =>
          addEvaluator({
            state: baseState(),
            payload: {
              evaluatorType: "langevals/exact_matches",
              name: "scored",
              inputs: [],
            },
          }),
        "evaluatorType",
      );

      expect(message).toContain(
        'Unknown evaluator type "langevals/exact_matches"',
      );
      expect(message).toContain('Run "langwatch evaluator types"');
    });
  });

  describe("when the payload names a type defined outside the built-in catalog", () => {
    it("accepts a project's own evaluator, whose type carries a row id", () => {
      const { state } = addEvaluator({
        state: baseState(),
        payload: {
          name: "scored",
          evaluatorType: "custom/evaluator_abc",
          inputs: [],
        },
      });

      expect(state.evaluators[1]?.evaluatorType).toBe("custom/evaluator_abc");
    });
  });
});

/**
 * The belt behind the payload schema: every caller that reaches state with an
 * already-typed EvaluatorConfig, which is what the browser store does.
 */
describe("attachEvaluator", () => {
  describe("when the evaluator is a plain one carrying a comparison config", () => {
    /** @scenario "Only the comparison judge can be a standalone comparison column" */
    it("refuses with evaluator_comparison_type_invalid", () => {
      expect(
        refusalCode(() =>
          attachEvaluator({
            state: baseState(),
            evaluator: {
              id: "evaluator_2",
              evaluatorType: "langevals/exact_match",
              inputs: [],
              mappings: {},
              comparison: comparisonConfig,
            } as EvaluatorConfig,
          }),
        ),
      ).toBe("evaluator_comparison_type_invalid");
    });
  });

  describe("when the evaluator is the comparison judge", () => {
    it("attaches it", () => {
      const state = attachEvaluator({
        state: baseState(),
        evaluator: {
          id: "evaluator_2",
          evaluatorType: COMPARISON_EVALUATOR_TYPE,
          inputs: [],
          mappings: {},
          comparison: comparisonConfig,
        } as EvaluatorConfig,
      });

      expect(state.evaluators.map((e) => e.id)).toEqual([
        "evaluator_1",
        "evaluator_2",
      ]);
    });
  });
});
