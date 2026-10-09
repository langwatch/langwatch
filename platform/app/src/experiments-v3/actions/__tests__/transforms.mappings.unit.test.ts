/**
 * @see specs/experiments-v3/workbench-actions.feature
 */
import { describe, expect, it } from "vitest";
import { setEvaluatorMapping, setTargetMapping } from "../transforms";
import {
  baseState,
  refusalCode,
  secondInlineDataset,
} from "./workbenchFixtures";

describe("setTargetMapping", () => {
  it("writes the mapping for that dataset only", () => {
    const state = baseState();
    state.datasets.push(secondInlineDataset());

    const { state: next } = setTargetMapping({
      state,
      payload: {
        targetId: "target-a",
        datasetId: "ds-2",
        inputField: "input",
        mapping: { type: "value", value: "constant" },
      },
    });

    expect(next.targets[0]!.mappings["ds-2"]!.input).toEqual({
      type: "value",
      value: "constant",
    });
    expect(next.targets[0]!.mappings["ds-1"]!.input).toBeDefined();
  });

  it("refuses an unknown target", () => {
    expect(
      refusalCode(() =>
        setTargetMapping({
          state: baseState(),
          payload: {
            targetId: "nope",
            datasetId: "ds-1",
            inputField: "input",
            mapping: { type: "value", value: "x" },
          },
        }),
      ),
    ).toBe("target_not_found");
  });

  describe("when the dataset does not exist", () => {
    /** @scenario "A mapping only names entities the workbench holds" */
    it("refuses with dataset_not_found", () => {
      expect(
        refusalCode(() =>
          setTargetMapping({
            state: baseState(),
            payload: {
              targetId: "target-a",
              datasetId: "nope",
              inputField: "input",
              mapping: { type: "value", value: "x" },
            },
          }),
        ),
      ).toBe("dataset_not_found");
    });
  });
});

describe("setEvaluatorMapping", () => {
  it("writes into the dataset and target bucket", () => {
    const { state } = setEvaluatorMapping({
      state: baseState(),
      payload: {
        evaluatorId: "evaluator_1",
        datasetId: "ds-1",
        targetId: "target-a",
        inputField: "rubric",
        mapping: { type: "value", value: "be exact" },
      },
    });

    expect(state.evaluators[0]!.mappings["ds-1"]!["target-a"]!.rubric).toEqual({
      type: "value",
      value: "be exact",
    });
  });

  it("refuses an unknown evaluator", () => {
    expect(
      refusalCode(() =>
        setEvaluatorMapping({
          state: baseState(),
          payload: {
            evaluatorId: "nope",
            datasetId: "ds-1",
            targetId: "target-a",
            inputField: "rubric",
            mapping: { type: "value", value: "x" },
          },
        }),
      ),
    ).toBe("evaluator_not_found");
  });

  describe("when the dataset does not exist", () => {
    /** @scenario "A mapping only names entities the workbench holds" */
    it("refuses with dataset_not_found", () => {
      expect(
        refusalCode(() =>
          setEvaluatorMapping({
            state: baseState(),
            payload: {
              evaluatorId: "evaluator_1",
              datasetId: "nope",
              targetId: "target-a",
              inputField: "rubric",
              mapping: { type: "value", value: "x" },
            },
          }),
        ),
      ).toBe("dataset_not_found");
    });
  });

  describe("when the target does not exist", () => {
    /** @scenario "A mapping only names entities the workbench holds" */
    it("refuses with target_not_found", () => {
      expect(
        refusalCode(() =>
          setEvaluatorMapping({
            state: baseState(),
            payload: {
              evaluatorId: "evaluator_1",
              datasetId: "ds-1",
              targetId: "nope",
              inputField: "rubric",
              mapping: { type: "value", value: "x" },
            },
          }),
        ),
      ).toBe("target_not_found");
    });
  });

  describe("when a mapping is refused", () => {
    /** @scenario "A mapping only names entities the workbench holds" */
    it("stores no mapping for the bucket it named", () => {
      const state = baseState();
      let produced: unknown;

      refusalCode(() => {
        produced = setEvaluatorMapping({
          state,
          payload: {
            evaluatorId: "evaluator_1",
            datasetId: "nope",
            targetId: "target-a",
            inputField: "rubric",
            mapping: { type: "value", value: "x" },
          },
        });
        return produced;
      });

      // The refusal is what the transform produced instead of a state. Reading
      // the input alone would pass whether or not the bucket was built, since
      // a transform never writes into what it was given.
      expect(produced).toBeUndefined();
      expect(state.evaluators[0]!.mappings.nope).toBeUndefined();
    });
  });
});
