/**
 * The fold that turns a backend run's events into the cells the workbench
 * persists.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { describe, expect, it } from "vitest";
import { runResultsAreEmpty } from "../runResults";
import { UNNAMED_FAILURE } from "../types";
import {
  evaluatorResult,
  foldEvents,
  targetResult,
} from "./runResultsFixtures";

describe("run result folding", () => {
  describe("given a run that produced output for every row", () => {
    describe("when its events are folded", () => {
      it("keeps the run id, the outputs, the metadata and the evaluator results", () => {
        const draft = foldEvents([
          { type: "execution_started", runId: "run-1", total: 2 },
          { type: "cell_started", rowIndex: 0, targetId: "target-1" },
          targetResult({ rowIndex: 0, output: "first" }),
          evaluatorResult({ rowIndex: 0, score: 1 }),
          { type: "cell_started", rowIndex: 1, targetId: "target-1" },
          targetResult({ rowIndex: 1, output: "second" }),
          evaluatorResult({ rowIndex: 1, score: 0 }),
          {
            type: "done",
            summary: {
              runId: "run-1",
              totalCells: 2,
              completedCells: 2,
              failedCells: 0,
              duration: 10,
              timestamps: { startedAt: 1 },
            },
          },
        ]);

        expect(draft.runId).toBe("run-1");
        expect(draft.targetOutputs).toEqual({
          "target-1": ["first", "second"],
        });
        expect(draft.targetMetadata).toEqual({
          "target-1": [
            { cost: 0.01, duration: 120, traceId: "trace-0" },
            { cost: 0.01, duration: 120, traceId: "trace-1" },
          ],
        });
        expect(draft.evaluatorResults).toEqual({
          "target-1": {
            "evaluator-1": [
              { status: "processed", score: 1 },
              { status: "processed", score: 0 },
            ],
          },
        });
        expect(draft.errors).toEqual({});
        expect(runResultsAreEmpty(draft)).toBe(false);
      });
    });
  });

  describe("given a row that failed", () => {
    describe("when its events are folded", () => {
      it("stores the engine string and the failure code, not rendered copy", () => {
        const domainError = { code: "prompt_missing" } as never;
        const draft = foldEvents([
          { type: "cell_started", rowIndex: 0, targetId: "target-1" },
          {
            type: "target_result",
            rowIndex: 0,
            targetId: "target-1",
            output: undefined,
            error: "boom",
            domainError,
          },
        ]);

        expect(draft.errors).toEqual({ "target-1": ["boom"] });
        expect(draft.targetMetadata).toEqual({ "target-1": [{ domainError }] });
        expect(draft.targetOutputs).toEqual({});
      });

      it("falls back to the unnamed-failure marker when the engine said nothing", () => {
        const draft = foldEvents([
          {
            type: "target_result",
            rowIndex: 0,
            targetId: "target-1",
            output: undefined,
            domainError: { code: "unknown" } as never,
          },
        ]);

        expect(draft.errors["target-1"]?.[0]).toBe(UNNAMED_FAILURE);
      });
    });
  });

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
        ]);

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
        ]);

        expect(
          draft.evaluatorResults["target-1"]?.["evaluator-1"]?.[1],
        ).toMatchObject({
          status: "error",
          details: "evaluator_unreachable",
        });
      });

      /** @scenario "A failure that names no cell leaves the cells alone" */
      it("leaves the cells alone when the failure names none", () => {
        const draft = foldEvents([
          { type: "error", message: "lw.unnamed_failure" },
        ]);

        expect(runResultsAreEmpty(draft)).toBe(true);
      });
    });
  });

  describe("given a run that produced nothing", () => {
    describe("when it is checked for content", () => {
      it("reports the results as empty", () => {
        expect(
          runResultsAreEmpty(
            foldEvents([
              { type: "execution_started", runId: "run-1", total: 0 },
              { type: "progress", completed: 0, total: 0 },
            ]),
          ),
        ).toBe(true);
      });
    });
  });
});
