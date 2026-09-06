/**
 * @see specs/experiments-v3/workbench-actions.feature
 */
import { describe, expect, it } from "vitest";
import { duplicateTarget } from "../transforms";
import { baseState, evaluator, refusalCode } from "./workbench-fixtures";

describe("duplicateTarget", () => {
  describe("given a target with mappings and an evaluator wired to it", () => {
    it("adds a copy under a new target id", () => {
      const { state, result } = duplicateTarget({
        state: baseState(),
        payload: { targetId: "target-a" },
      });

      expect(state.targets).toHaveLength(2);
      expect(result?.targetId).toMatch(/^target-[\w-]{8}$/);
      expect(result?.targetId).not.toBe("target-a");
      const copy = state.targets[1]!;
      expect(copy.promptId).toBe("prompt-1");
      expect(copy.promptVersionNumber).toBe(3);
    });

    it("copies the target's own dataset mappings", () => {
      const { state } = duplicateTarget({
        state: baseState(),
        payload: { targetId: "target-a" },
      });

      expect(state.targets[1]!.mappings["ds-1"]!.input).toEqual({
        type: "source",
        source: "dataset",
        sourceId: "ds-1",
        sourceField: "input",
      });
    });

    /** @scenario "A duplicated target keeps the wiring of the target it came from" */
    it("copies every evaluator mapping bucket onto the copy", () => {
      const { state, result } = duplicateTarget({
        state: baseState(),
        payload: { targetId: "target-a" },
      });

      const copied = state.evaluators[0]!.mappings["ds-1"]![result!.targetId]!;
      expect(Object.keys(copied).sort()).toEqual(["expected_output", "output", "rubric"]);
      // The one no heuristic could re-infer.
      expect(copied.rubric).toEqual({ type: "value", value: "be concise" });
    });

    /** @scenario "A duplicated target is graded on its own output" */
    it("repoints an output mapping at the copy, not at the source column", () => {
      const { state, result } = duplicateTarget({
        state: baseState(),
        payload: { targetId: "target-a" },
      });

      expect(state.evaluators[0]!.mappings["ds-1"]![result!.targetId]!.output).toEqual({
        type: "source",
        source: "target",
        sourceId: result!.targetId,
        sourceField: "output",
      });
    });

    it("leaves the source target's mappings untouched", () => {
      const before = baseState();
      const { state } = duplicateTarget({
        state: before,
        payload: { targetId: "target-a" },
      });

      expect(state.evaluators[0]!.mappings["ds-1"]!["target-a"]).toEqual(
        evaluator().mappings["ds-1"]!["target-a"],
      );
      expect(before.targets).toHaveLength(1);
    });
  });

  describe("when the target is an evaluator target", () => {
    it("applies the name override to its local config", () => {
      const state = baseState();
      state.targets = [
        {
          id: "target-eval",
          type: "evaluator",
          targetEvaluatorId: "db-evaluator-2",
          localEvaluatorConfig: { name: "Judge" },
          inputs: [],
          outputs: [],
          mappings: {},
        },
      ];

      const { state: next, result } = duplicateTarget({
        state,
        payload: { targetId: "target-eval", name: "Judge copy" },
      });

      expect(next.targets[1]!.localEvaluatorConfig?.name).toBe("Judge copy");
      expect(result?.name).toBe("Judge copy");
    });
  });

  describe("when the target takes its name from a prompt", () => {
    it("reports the name as unapplied", () => {
      const { result } = duplicateTarget({
        state: baseState(),
        payload: { targetId: "target-a", name: "Ignored" },
      });

      expect(result?.name).toBeUndefined();
    });
  });

  describe("when the target does not exist", () => {
    it("refuses with target_not_found", () => {
      expect(
        refusalCode(() =>
          duplicateTarget({
            state: baseState(),
            payload: { targetId: "nope" },
          }),
        ),
      ).toBe("target_not_found");
    });
  });
});
