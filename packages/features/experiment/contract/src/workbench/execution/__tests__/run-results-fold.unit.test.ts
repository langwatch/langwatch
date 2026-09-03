/**
 * The fold that turns a backend run's events into the cells the workbench
 * persists.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { describe, expect, it } from "vitest";
import { runResultsAreEmpty } from "../run-results";
import { foldEvents } from "./run-results-fixtures";

describe("run result folding", () => {
  describe("given a cell the engine reported as an error rather than a result", () => {
    describe("when its events are folded", () => {
      /** @scenario "A run whose cells all fail writes those failures into the cells" */
      it("marks the cell failed so the table shows the failure", () => {
        const domainError = { code: "prompt_missing" } as never;
        const draft = foldEvents([
          { type: "cell_started", rowIndex: 0, targetId: "target-1" },
          {
            type: "error",
            message: "lw.unnamed_failure",
            rowIndex: 0,
            targetId: "target-1",
            domainError,
          },
        ] as never);

        expect(draft.errors).toEqual({ "target-1": ["lw.unnamed_failure"] });
        expect(draft.targetMetadata).toEqual({ "target-1": [{ domainError }] });
        expect(runResultsAreEmpty(draft)).toBe(false);
      });

      /** @scenario "A run whose cells all fail writes those failures into the cells" */
      it("marks an evaluator that failed on its own cell", () => {
        const draft = foldEvents([
          {
            type: "error",
            message: "evaluator_unreachable",
            rowIndex: 1,
            targetId: "target-1",
            evaluatorId: "evaluator-1",
          },
        ] as never);

        expect(draft.evaluatorResults["target-1"]?.["evaluator-1"]?.[1]).toMatchObject({
          status: "error",
          details: "evaluator_unreachable",
        });
      });

      /** @scenario "A failure that names no cell leaves the cells alone" */
      it("leaves the cells alone when the failure names none", () => {
        const draft = foldEvents([{ type: "error", message: "lw.unnamed_failure" }] as never);

        expect(runResultsAreEmpty(draft)).toBe(true);
      });
    });
  });
});
