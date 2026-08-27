import { describe, expect, it } from "vitest";
import type { EvaluationV3Event } from "~/server/experiments-v3/execution/types";
import { UNNAMED_FAILURE } from "~/server/experiments-v3/execution/types";
import type { EvaluationResults } from "../../types";
import { foldEvaluationEvent, foldEvaluationEvents } from "../resultsFold";

const emptyResults = (): EvaluationResults => ({
  status: "idle",
  targetOutputs: {},
  targetMetadata: {},
  evaluatorResults: {},
  errors: {},
});

const fold = (
  events: EvaluationV3Event[],
  {
    results = emptyResults(),
    evaluatorIds = ["evaluator_1"],
  }: { results?: EvaluationResults; evaluatorIds?: string[] } = {},
): EvaluationResults => foldEvaluationEvents({ results, events, evaluatorIds });

describe("foldEvaluationEvent", () => {
  describe("given a run that starts", () => {
    describe("when the execution_started frame arrives", () => {
      it("names the run and sizes it", () => {
        const folded = fold([
          { type: "execution_started", runId: "swift-bold-fox", total: 6 },
        ]);

        expect(folded.runId).toBe("swift-bold-fox");
        expect(folded.status).toBe("running");
        expect(folded.progress).toBe(0);
        expect(folded.total).toBe(6);
      });
    });
  });

  describe("given a target that answers", () => {
    describe("when the target_result frame carries an output", () => {
      it("writes the cell and its metadata", () => {
        const folded = fold([
          {
            type: "target_result",
            rowIndex: 1,
            targetId: "target-a",
            output: "yes",
            cost: 0.02,
            duration: 120,
            traceId: "trace-1",
          },
        ]);

        expect(folded.targetOutputs["target-a"]?.[1]).toBe("yes");
        expect(folded.targetMetadata["target-a"]?.[1]).toEqual({
          cost: 0.02,
          duration: 120,
          traceId: "trace-1",
        });
      });

      it("marks every evaluator of the cell as running", () => {
        const folded = fold(
          [
            {
              type: "target_result",
              rowIndex: 0,
              targetId: "target-a",
              output: "yes",
            },
          ],
          { evaluatorIds: ["evaluator_1", "evaluator_2"] },
        );

        expect([...(folded.runningEvaluators ?? [])]).toEqual([
          "0:target-a:evaluator_1",
          "0:target-a:evaluator_2",
        ]);
      });

      it("leaves the other rows of the column alone", () => {
        const results = emptyResults();
        results.targetOutputs["target-a"] = ["kept"];

        const folded = fold(
          [
            {
              type: "target_result",
              rowIndex: 2,
              targetId: "target-a",
              output: "new",
            },
          ],
          { results },
        );

        expect(folded.targetOutputs["target-a"]?.[0]).toBe("kept");
        expect(folded.targetOutputs["target-a"]?.[2]).toBe("new");
      });
    });

    describe("when the target_result frame carries a failure", () => {
      it("stores the code beside the engine's own string", () => {
        const folded = fold([
          {
            type: "target_result",
            rowIndex: 0,
            targetId: "target-a",
            output: undefined,
            error: "httpblock: no such host",
            domainError: { code: "target_unreachable" } as never,
          },
        ]);

        expect(folded.errors["target-a"]?.[0]).toBe("httpblock: no such host");
        expect(folded.targetMetadata["target-a"]?.[0]?.domainError).toEqual({
          code: "target_unreachable",
        });
        expect(folded.targetOutputs["target-a"]).toBeUndefined();
      });

      it("marks a failure nobody could name", () => {
        const folded = fold([
          {
            type: "target_result",
            rowIndex: 0,
            targetId: "target-a",
            output: undefined,
            domainError: { code: "unknown" } as never,
          },
        ]);

        expect(folded.errors["target-a"]?.[0]).toBe(UNNAMED_FAILURE);
      });
    });
  });

  describe("given an evaluator that answers", () => {
    describe("when its result arrives", () => {
      it("writes the verdict and stops reporting it as running", () => {
        const started = fold([
          {
            type: "target_result",
            rowIndex: 0,
            targetId: "target-a",
            output: "yes",
          },
        ]);

        const folded = fold(
          [
            {
              type: "evaluator_result",
              rowIndex: 0,
              targetId: "target-a",
              evaluatorId: "evaluator_1",
              result: { status: "processed", passed: true } as never,
            },
          ],
          { results: started },
        );

        expect(folded.evaluatorResults["target-a"]?.evaluator_1?.[0]).toEqual({
          status: "processed",
          passed: true,
        });
        expect(folded.runningEvaluators).toBeUndefined();
      });
    });

    /**
     * A comparison re-run that cannot read a variant reports it per row, and
     * that report has to REPLACE the verdict already in the cell. Dropping it
     * because a value was there is how a stale verdict outlives the run that
     * invalidated it.
     */
    describe("when a comparison reports a variant it is waiting on", () => {
      it("overwrites the verdict that was in the cell", () => {
        const results = emptyResults();
        results.evaluatorResults["target-a"] = {
          evaluator_compare: [{ status: "processed", label: "target-b" }],
        };

        const folded = fold(
          [
            {
              type: "evaluator_result",
              rowIndex: 0,
              targetId: "target-a",
              evaluatorId: "evaluator_compare",
              result: {
                status: "error",
                error_type: "MissingVariantOutput",
                details: "Waiting on category_classifier (1)",
              } as never,
            },
          ],
          { results },
        );

        expect(
          folded.evaluatorResults["target-a"]?.evaluator_compare?.[0],
        ).toEqual({
          status: "error",
          error_type: "MissingVariantOutput",
          details: "Waiting on category_classifier (1)",
        });
      });
    });
  });

  describe("given a cell-level error frame", () => {
    describe("when it names an evaluator", () => {
      it("writes an evaluator error row with the described copy", () => {
        const folded = foldEvaluationEvent({
          results: emptyResults(),
          event: {
            type: "error",
            message: "validation_error",
            rowIndex: 0,
            targetId: "target-a",
            evaluatorId: "evaluator_1",
          },
          evaluatorIds: ["evaluator_1"],
          describeCellError: () => "This row couldn't be run",
        });

        expect(folded.evaluatorResults["target-a"]?.evaluator_1?.[0]).toEqual({
          status: "error",
          error_type: "EvaluatorError",
          details: "This row couldn't be run",
          traceback: [],
        });
      });
    });

    describe("when it names only a target", () => {
      it("writes the wire message as the cell's failure", () => {
        const folded = fold([
          {
            type: "error",
            message: "validation_error",
            rowIndex: 3,
            targetId: "target-a",
          },
        ]);

        expect(folded.errors["target-a"]?.[3]).toBe("validation_error");
      });
    });

    describe("when it names no cell at all", () => {
      it("leaves the cells alone, because the run's own status carries it", () => {
        const folded = fold([
          { type: "error", message: UNNAMED_FAILURE, traceId: "trace-1" },
        ]);

        expect(folded).toEqual(emptyResults());
      });
    });
  });

  describe("given a run that reports progress and ends", () => {
    it("counts the cells and records how it ended", () => {
      const folded = fold([
        { type: "execution_started", runId: "run-1", total: 4 },
        { type: "progress", completed: 3, total: 4 },
        { type: "done", summary: {} as never },
      ]);

      expect(folded.progress).toBe(3);
      expect(folded.total).toBe(4);
      expect(folded.status).toBe("success");
    });

    it("records a stopped run as stopped", () => {
      const folded = fold([
        { type: "execution_started", runId: "run-1", total: 4 },
        { type: "stopped", reason: "user" },
      ]);

      expect(folded.status).toBe("stopped");
    });
  });
});
