/**
 * The fold that turns a backend run's events into the cells the workbench
 * persists, and the merge that folds them into the cells already saved.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { describe, expect, it } from "vitest";
import type { PersistedResults } from "~/experiments-v3/types/persistence";
import {
  applyRunEvent,
  emptyRunResultsDraft,
  mergeRunResults,
  planRunMerge,
  type RunResultsDraft,
  runResultsAreEmpty,
} from "../runResults";
import type { EvaluationV3Event, ExecutionScope } from "../types";
import { UNNAMED_FAILURE } from "../types";

const foldEvents = (events: EvaluationV3Event[]): RunResultsDraft => {
  const draft = emptyRunResultsDraft();
  for (const event of events) applyRunEvent({ draft, event });
  return draft;
};

const targetResult = ({
  rowIndex,
  output,
}: {
  rowIndex: number;
  output: unknown;
}): EvaluationV3Event => ({
  type: "target_result",
  rowIndex,
  targetId: "target-1",
  output,
  cost: 0.01,
  duration: 120,
  traceId: `trace-${rowIndex}`,
});

const evaluatorResult = ({
  rowIndex,
  score,
}: {
  rowIndex: number;
  score: number;
}): EvaluationV3Event => ({
  type: "evaluator_result",
  rowIndex,
  targetId: "target-1",
  evaluatorId: "evaluator-1",
  result: { status: "processed", score } as never,
});

describe("run results", () => {
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

  describe("given a scope", () => {
    describe("when the merge is planned", () => {
      const cases: Array<{
        name: string;
        scope: ExecutionScope;
        expected: ReturnType<typeof planRunMerge>;
      }> = [
        {
          name: "full",
          scope: { type: "full" },
          expected: { mode: "replace" },
        },
        {
          name: "rows",
          scope: { type: "rows", rowIndices: [1] },
          expected: { mode: "merge", keepTargetCells: false },
        },
        {
          name: "target",
          scope: { type: "target", targetId: "target-1" },
          expected: { mode: "merge", keepTargetCells: false },
        },
        {
          name: "target-rows",
          scope: { type: "target-rows", targetIds: ["target-1"] },
          expected: { mode: "merge", keepTargetCells: false },
        },
        {
          name: "cell",
          scope: { type: "cell", targetId: "target-1", rowIndex: 0 },
          expected: { mode: "merge", keepTargetCells: false },
        },
        {
          name: "evaluator",
          scope: {
            type: "evaluator",
            targetId: "target-1",
            rowIndex: 0,
            evaluatorId: "evaluator-1",
          },
          expected: {
            mode: "merge",
            keepTargetCells: true,
            evaluatorId: "evaluator-1",
          },
        },
        {
          name: "evaluator-all-rows",
          scope: {
            type: "evaluator-all-rows",
            targetId: "target-1",
            evaluatorId: "evaluator-1",
            precomputedTargetOutputs: {},
            traceIds: {},
          },
          expected: {
            mode: "merge",
            keepTargetCells: true,
            evaluatorId: "evaluator-1",
          },
        },
      ];

      for (const { name, scope, expected } of cases) {
        it(`plans ${name} the way the workbench store does`, () => {
          expect(planRunMerge(scope)).toEqual(expected);
        });
      }
    });
  });

  describe("given results already saved for every row", () => {
    const existing: PersistedResults = {
      runId: "run-0",
      versionId: "version-0",
      targetOutputs: { "target-1": ["old first", "old second"] },
      targetMetadata: {
        "target-1": [{ traceId: "old-0" }, { traceId: "old-1" }],
      },
      evaluatorResults: {
        "target-1": { "evaluator-1": [{ score: 9 }, { score: 8 }] },
      },
      errors: { "target-1": ["old failure", null] },
    };

    describe("when a full run finishes", () => {
      it("replaces every cell and keeps the setup's version id", () => {
        const draft = foldEvents([
          { type: "execution_started", runId: "run-1", total: 1 },
          targetResult({ rowIndex: 0, output: "fresh" }),
        ]);

        expect(
          mergeRunResults({ existing, draft, plan: { mode: "replace" } }),
        ).toEqual({
          runId: "run-1",
          versionId: "version-0",
          targetOutputs: { "target-1": ["fresh"] },
          targetMetadata: {
            "target-1": [{ cost: 0.01, duration: 120, traceId: "trace-0" }],
          },
          evaluatorResults: {},
          errors: {},
        });
      });
    });

    describe("when a run of one row finishes", () => {
      it("refills that row and leaves the other row as it was", () => {
        const draft = foldEvents([
          { type: "execution_started", runId: "run-1", total: 1 },
          { type: "cell_started", rowIndex: 1, targetId: "target-1" },
          targetResult({ rowIndex: 1, output: "fresh second" }),
          evaluatorResult({ rowIndex: 1, score: 5 }),
        ]);

        const merged = mergeRunResults({
          existing,
          draft,
          plan: planRunMerge({ type: "rows", rowIndices: [1] }),
        });

        expect(merged.runId).toBe("run-1");
        expect(merged.targetOutputs["target-1"]).toEqual([
          "old first",
          "fresh second",
        ]);
        expect(merged.targetMetadata["target-1"]).toEqual([
          { traceId: "old-0" },
          { cost: 0.01, duration: 120, traceId: "trace-1" },
        ]);
        expect(merged.evaluatorResults["target-1"]?.["evaluator-1"]).toEqual([
          { score: 9 },
          { status: "processed", score: 5 },
        ]);
      });

      it("clears the row's stale failure when the row now succeeds", () => {
        const draft = foldEvents([
          { type: "cell_started", rowIndex: 0, targetId: "target-1" },
          targetResult({ rowIndex: 0, output: "fresh first" }),
        ]);

        const merged = mergeRunResults({
          existing,
          draft,
          plan: planRunMerge({ type: "rows", rowIndices: [0] }),
        });

        expect(merged.errors["target-1"]).toEqual([undefined, null]);
        expect(merged.targetOutputs["target-1"]).toEqual([
          "fresh first",
          "old second",
        ]);
      });

      it("leaves the saved results untouched", () => {
        const before = structuredClone(existing);
        mergeRunResults({
          existing,
          draft: foldEvents([targetResult({ rowIndex: 0, output: "fresh" })]),
          plan: planRunMerge({ type: "rows", rowIndices: [0] }),
        });
        expect(existing).toEqual(before);
      });
    });

    describe("when a run of one evaluator finishes", () => {
      it("keeps the target outputs and the other evaluators' scores", () => {
        const withTwoEvaluators: PersistedResults = {
          ...existing,
          evaluatorResults: {
            "target-1": {
              "evaluator-1": [{ score: 9 }, { score: 8 }],
              "evaluator-2": [{ score: 1 }, { score: 2 }],
            },
          },
        };

        const merged = mergeRunResults({
          existing: withTwoEvaluators,
          draft: foldEvents([
            { type: "cell_started", rowIndex: 0, targetId: "target-1" },
            evaluatorResult({ rowIndex: 0, score: 7 }),
          ]),
          plan: planRunMerge({
            type: "evaluator",
            targetId: "target-1",
            rowIndex: 0,
            evaluatorId: "evaluator-1",
          }),
        });

        expect(merged.targetOutputs["target-1"]).toEqual([
          "old first",
          "old second",
        ]);
        expect(merged.evaluatorResults["target-1"]).toEqual({
          "evaluator-1": [{ status: "processed", score: 7 }, { score: 8 }],
          "evaluator-2": [{ score: 1 }, { score: 2 }],
        });
      });
    });
  });

  describe("given no results saved yet", () => {
    describe("when a scoped run finishes", () => {
      it("writes only the rows the run covered", () => {
        const merged = mergeRunResults({
          draft: foldEvents([
            { type: "execution_started", runId: "run-1", total: 1 },
            { type: "cell_started", rowIndex: 2, targetId: "target-1" },
            targetResult({ rowIndex: 2, output: "third" }),
          ]),
          plan: planRunMerge({ type: "rows", rowIndices: [2] }),
        });

        expect(merged.runId).toBe("run-1");
        expect(merged.versionId).toBeUndefined();
        expect(merged.targetOutputs["target-1"]).toEqual([
          undefined,
          undefined,
          "third",
        ]);
      });
    });
  });
});
