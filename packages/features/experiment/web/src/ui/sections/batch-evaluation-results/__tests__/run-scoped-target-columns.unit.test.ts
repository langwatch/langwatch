/**
 * Which target columns a run renders.
 *
 * A run stores the whole board in its Targets snapshot, so a run scoped to one
 * column still declares its siblings. The results page reads that snapshot, so
 * without a filter it draws a column per declared target and the ones the run
 * never executed show no output, no latency and no score.
 *
 * @see specs/batch-evaluation-results/target-column-identity.feature
 */
import { describe, expect, it } from "vitest";
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { transformBatchEvaluationData } from "@langwatch/experiment-web";

const TARGETS = [
  { id: "target-classifier", name: "classifier", type: "prompt" },
  { id: "target-summarizer", name: "summarizer", type: "prompt" },
];

const runWithRowsFor = (targetIds: string[]): ExperimentRunWithItems => ({
  experimentId: "exp-1",
  runId: "run-1",
  projectId: "proj-1",
  targets: TARGETS,
  dataset: targetIds.map((targetId) => ({
    index: 0,
    targetId,
    entry: { input: "a question" },
    predicted: { output: "an answer" },
    cost: 0.001,
    duration: 400,
  })),
  evaluations: [],
  timestamps: { createdAt: 1, updatedAt: 1 },
});

describe("given a run whose Targets snapshot lists the whole board", () => {
  describe("when the run holds rows for one target only", () => {
    /** @scenario "A run scoped to one target renders only that target" */
    it("keeps the target with rows and drops the other", () => {
      const result = transformBatchEvaluationData(
        runWithRowsFor(["target-classifier"]),
      );

      expect(result.targetColumns.map((c) => c.id)).toEqual([
        "target-classifier",
      ]);
    });
  });

  describe("when the run holds rows for every target", () => {
    it("keeps them all", () => {
      const result = transformBatchEvaluationData(
        runWithRowsFor(["target-classifier", "target-summarizer"]),
      );

      expect(result.targetColumns.map((c) => c.id)).toEqual([
        "target-classifier",
        "target-summarizer",
      ]);
    });
  });

  describe("when the run has produced no rows yet", () => {
    /** @scenario "A run that has produced no rows yet keeps every declared target" */
    it("keeps every declared target so the table is not empty", () => {
      const result = transformBatchEvaluationData(runWithRowsFor([]));

      expect(result.targetColumns.map((c) => c.id)).toEqual([
        "target-classifier",
        "target-summarizer",
      ]);
    });
  });

  describe("when a comparison evaluator is a target of its own", () => {
    /** @scenario "A comparison column keeps its place though it owns no rows" */
    it("keeps it, though it holds a verdict rather than an output row", () => {
      const run = runWithRowsFor(["target-classifier", "target-summarizer"]);
      run.targets = [
        ...TARGETS,
        { id: "cmp-1", name: "Comparison", type: "evaluator" },
      ];
      run.evaluations = [
        {
          evaluator: "cmp-1",
          status: "processed",
          index: 0,
          label: "classifier",
          inputs: {
            candidates: [
              { id: "target-classifier", output: "an answer" },
              { id: "target-summarizer", output: "another answer" },
            ],
            row_index: 0,
          },
        },
      ];

      const result = transformBatchEvaluationData(run);

      expect(result.targetColumns.map((c) => c.id)).toContain("cmp-1");
    });
  });

  describe("when two declared targets share one name", () => {
    /** @scenario "A same-named target keeps one label across the runs it is compared in" */
    it("labels the second target the same way whichever run holds its rows", () => {
      const sameNamedBoard = [
        { id: "target-a", name: "classifier", type: "prompt" },
        { id: "target-b", name: "classifier", type: "prompt" },
      ];

      const labelFor = (targetIds: string[]): string | undefined => {
        const run = runWithRowsFor(targetIds);
        run.targets = sameNamedBoard;
        return transformBatchEvaluationData(run).targetColumns.find(
          (column) => column.id === "target-b",
        )?.displayName;
      };

      // Compare mode merges columns by target id across runs, so a label that
      // moved with a run's own coverage would name one target two ways.
      expect(labelFor(["target-a", "target-b"])).toBe("classifier (2)");
      expect(labelFor(["target-b"])).toBe("classifier (2)");
    });
  });

  describe("when an evaluation names a target that has no dataset row", () => {
    it("keeps that target, because the run did execute it", () => {
      const run = runWithRowsFor(["target-classifier"]);
      run.evaluations = [
        {
          evaluator: "exact-match",
          targetId: "target-summarizer",
          status: "processed",
          index: 0,
          score: 1,
        },
      ];

      const result = transformBatchEvaluationData(run);

      expect(result.targetColumns.map((c) => c.id)).toEqual([
        "target-classifier",
        "target-summarizer",
      ]);
    });
  });
});
