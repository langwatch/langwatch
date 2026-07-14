/**
 * Detection of comparison columns from a stored run.
 *
 * Exercised through `transformBatchEvaluationData` rather than the private
 * detector, because the winner-output lookup depends on rows the transformer
 * builds. These are the shapes that actually live in the database.
 */
import { describe, expect, it } from "vitest";
import type { ExperimentRunWithItems } from "~/server/experiments-v3/services/types";
import { transformBatchEvaluationData } from "../types";

const createTimestamps = () => ({ createdAt: 1, updatedAt: 1 });

/** Three prompt variants plus the synthetic comparison column-target. */
const THREE_VARIANT_TARGETS = [
  { id: "target-a", name: "concise-support-v2", type: "prompt" },
  { id: "target-b", name: "friendly-support-v3", type: "prompt" },
  { id: "target-c", name: "polite-assistant-v1", type: "prompt" },
  { id: "cmp-1", name: "Comparison", type: "evaluator" },
];

const datasetFor = (rowCount: number, targetIds: string[]) =>
  Array.from({ length: rowCount }).flatMap((_, index) =>
    targetIds.map((targetId) => ({
      index,
      targetId,
      entry: { input: `question ${index}` },
      predicted: { output: `${targetId} answer ${index}` },
    })),
  );

/** What the merged orchestrator writes: an ordered `candidates` list. */
const candidatesInput = (ids: string[]) => ({
  candidates: ids.map((id) => ({ id, output: `${id} answer` })),
  row_index: 0,
});

const createRun = (
  evaluations: ExperimentRunWithItems["evaluations"],
  {
    targets = THREE_VARIANT_TARGETS,
    rowCount = 3,
  }: { targets?: typeof THREE_VARIANT_TARGETS; rowCount?: number } = {},
): ExperimentRunWithItems => ({
  experimentId: "exp-1",
  runId: "run-1",
  projectId: "proj-1",
  targets,
  dataset: datasetFor(
    rowCount,
    targets.filter((t) => t.type !== "evaluator").map((t) => t.id),
  ),
  evaluations,
  timestamps: createTimestamps(),
});

describe("detecting comparison columns", () => {
  describe("given a three-way comparison", () => {
    describe("when the third variant wins a row", () => {
      // The pre-merge detector normalized every verdict into an A/B slot and
      // dropped anything that matched neither, so the third variant's wins
      // silently vanished from the win-rate chart.
      it("counts the third variant's win rather than dropping it", () => {
        const run = createRun([
          {
            evaluator: "cmp-1",
            status: "processed",
            index: 0,
            label: "concise-support-v2",
            inputs: candidatesInput(["target-a", "target-b", "target-c"]),
          },
          {
            evaluator: "cmp-1",
            status: "processed",
            index: 1,
            label: "polite-assistant-v1",
            inputs: candidatesInput(["target-a", "target-b", "target-c"]),
          },
          {
            evaluator: "cmp-1",
            status: "processed",
            index: 2,
            label: "polite-assistant-v1",
            inputs: candidatesInput(["target-a", "target-b", "target-c"]),
          },
        ]);

        const column = transformBatchEvaluationData(run).comparisonColumns![0]!;

        expect(column.variants.map((v) => v.id)).toEqual([
          "target-a",
          "target-b",
          "target-c",
        ]);
        expect(column.verdictsByRow[1]?.winnerId).toBe("target-c");
        expect(column.verdictsByRow[2]?.winnerId).toBe("target-c");
      });
    });

    describe("when a variant never wins", () => {
      it("still lists it, because the judge's inputs name every candidate", () => {
        const run = createRun([
          {
            evaluator: "cmp-1",
            status: "processed",
            index: 0,
            label: "concise-support-v2",
            inputs: candidatesInput(["target-a", "target-b", "target-c"]),
          },
        ]);

        const column = transformBatchEvaluationData(run).comparisonColumns![0]!;

        expect(column.variants).toHaveLength(3);
        expect(column.variants.map((v) => v.name)).toEqual([
          "concise-support-v2",
          "friendly-support-v3",
          "polite-assistant-v1",
        ]);
      });
    });

    describe("when the judge ties a row", () => {
      it("records no winner for that row", () => {
        const run = createRun([
          {
            evaluator: "cmp-1",
            status: "processed",
            index: 0,
            label: "tie",
            inputs: candidatesInput(["target-a", "target-b", "target-c"]),
          },
        ]);

        const column = transformBatchEvaluationData(run).comparisonColumns![0]!;

        expect(column.verdictsByRow[0]?.winnerId).toBeNull();
        expect(column.verdictsByRow[0]?.winnerOutput).toBeNull();
      });
    });

    describe("when a winner is named", () => {
      it("surfaces that variant's own output for the row", () => {
        const run = createRun([
          {
            evaluator: "cmp-1",
            status: "processed",
            index: 0,
            label: "friendly-support-v3",
            details: "B is warmer",
            inputs: candidatesInput(["target-a", "target-b", "target-c"]),
          },
        ]);

        const column = transformBatchEvaluationData(run).comparisonColumns![0]!;

        expect(column.verdictsByRow[0]?.winnerOutput).toBe("target-b answer 0");
        expect(column.verdictsByRow[0]?.reasoning).toBe("B is warmer");
      });
    });

    describe("when every row ties and inputs carry no candidate ids", () => {
      // "tie" is valid vocabulary under both the legacy 2-slot and current
      // N-way contract, so seeing it alone must NOT be treated as evidence
      // of the legacy shape — only "A"/"B" are. A prior bug treated "tie"
      // as slot evidence, so a genuinely-3-way bucket with no other signal
      // wrongly fell back to a hardcoded 2-variant slice, silently dropping
      // the third variant.
      it("does not collapse to a hardcoded 2 variants", () => {
        const run = createRun([
          { evaluator: "cmp-1", status: "processed", index: 0, label: "tie", inputs: {} },
          { evaluator: "cmp-1", status: "processed", index: 1, label: "tie", inputs: {} },
        ]);

        const column = transformBatchEvaluationData(run).comparisonColumns![0]!;

        expect(column.variants.map((v) => v.id)).not.toEqual([
          "target-a",
          "target-b",
        ]);
      });
    });
  });

  describe("given a legacy pairwise run", () => {
    const TWO_VARIANT_TARGETS = [
      { id: "target-a", name: "say-hi", type: "prompt" },
      { id: "target-b", name: "be-formal", type: "prompt" },
      { id: "pw-1", name: "Pairwise Compare", type: "evaluator" },
    ];

    describe("when verdicts use slot labels and inputs use candidate_a_id", () => {
      it("resolves A and B onto the variants those slots name", () => {
        const run = createRun(
          [
            {
              evaluator: "pw-1",
              status: "processed",
              index: 0,
              label: "A",
              inputs: { candidate_a_id: "target-a", candidate_b_id: "target-b" },
            },
            {
              evaluator: "pw-1",
              status: "processed",
              index: 1,
              label: "B",
              inputs: { candidate_a_id: "target-a", candidate_b_id: "target-b" },
            },
          ],
          { targets: TWO_VARIANT_TARGETS, rowCount: 2 },
        );

        const column = transformBatchEvaluationData(run).comparisonColumns![0]!;

        expect(column.variants.map((v) => v.id)).toEqual([
          "target-a",
          "target-b",
        ]);
        expect(column.verdictsByRow[0]?.winnerId).toBe("target-a");
        expect(column.verdictsByRow[1]?.winnerId).toBe("target-b");
      });
    });

    describe("when only one variant ever wins", () => {
      it("still names the losing variant, from the judge's inputs", () => {
        const run = createRun(
          [
            {
              evaluator: "pw-1",
              status: "processed",
              index: 0,
              label: "A",
              inputs: { candidate_a_id: "target-a", candidate_b_id: "target-b" },
            },
          ],
          { targets: TWO_VARIANT_TARGETS, rowCount: 1 },
        );

        const column = transformBatchEvaluationData(run).comparisonColumns![0]!;

        expect(column.variants.map((v) => v.name)).toEqual([
          "say-hi",
          "be-formal",
        ]);
      });
    });
  });

  describe("given a run whose winner names no known target", () => {
    // A variant removed from the experiment since the run. Its wins must still
    // be counted, or the chart quietly under-reports.
    it("keeps the raw identifier as a variant of its own", () => {
      const run = createRun([
        {
          evaluator: "cmp-1",
          status: "processed",
          index: 0,
          label: "deleted-prompt-v9",
          inputs: {},
        },
      ]);

      const column = transformBatchEvaluationData(run).comparisonColumns![0]!;

      expect(column.variants.map((v) => v.id)).toContain("deleted-prompt-v9");
      expect(column.verdictsByRow[0]?.winnerId).toBe("deleted-prompt-v9");
    });
  });

  describe("given a plain scalar evaluator", () => {
    it("is not detected as a comparison", () => {
      const run = createRun(
        [
          {
            evaluator: "exact_match",
            name: "Exact Match",
            status: "processed",
            index: 0,
            score: 1,
            passed: true,
          },
        ],
        {
          targets: [{ id: "target-a", name: "say-hi", type: "prompt" }],
          rowCount: 1,
        },
      );

      expect(transformBatchEvaluationData(run).comparisonColumns).toEqual([]);
    });
  });
});
