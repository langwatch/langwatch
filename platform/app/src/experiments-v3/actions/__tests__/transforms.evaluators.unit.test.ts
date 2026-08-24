/**
 * @see specs/experiments-v3/workbench-actions.feature
 */
import { describe, expect, it } from "vitest";
import { addEvaluator } from "../transforms";
import { baseState, refusalCode } from "./workbenchFixtures";

describe("addEvaluator", () => {
  it("auto-maps across datasets and targets", () => {
    const { state, result } = addEvaluator({
      state: baseState(),
      payload: {
        evaluatorType: "langevals/exact_match",
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
            inputs: [],
          },
        }),
      ).toThrow();
    });
  });
});
