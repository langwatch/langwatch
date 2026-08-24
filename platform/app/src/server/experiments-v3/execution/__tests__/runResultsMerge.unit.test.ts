/**
 * The plan a scope produces, and the merge that folds a run's cells into the
 * cells already saved.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { describe, expect, it } from "vitest";
import type { PersistedResults } from "~/experiments-v3/types/persistence";
import { mergeRunResults, planRunMerge } from "../runResults";
import type { ExecutionScope } from "../types";
import {
  evaluatorResult,
  foldEvents,
  targetResult,
} from "./runResultsFixtures";

describe("run result merging", () => {
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
          expected: { mode: "merge", shouldKeepTargetCells: false },
        },
        {
          name: "target",
          scope: { type: "target", targetId: "target-1" },
          expected: { mode: "merge", shouldKeepTargetCells: false },
        },
        {
          name: "target-rows",
          scope: { type: "target-rows", targetIds: ["target-1"] },
          expected: { mode: "merge", shouldKeepTargetCells: false },
        },
        {
          name: "cell",
          scope: { type: "cell", targetId: "target-1", rowIndex: 0 },
          expected: { mode: "merge", shouldKeepTargetCells: false },
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
            shouldKeepTargetCells: true,
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
            shouldKeepTargetCells: true,
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
