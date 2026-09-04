/**
 * Facade-level seams: behaviour that crosses two collaborators, or proves
 * the facade's delegation is wired rather than merely present.
 * @see specs/experiments-v3/evaluation-execution.feature
 */
import { describe, expect, it } from "vitest";
import type { EvaluationsV3State } from "@langwatch/experiment-contract";
import { buildEvaluatorInputs, generateCells } from "../experiment-run-orchestrator.service";

const createTestDataset = (rowCount = 3) =>
  Array.from({ length: rowCount }, (_, i) => ({
    question: `Question ${i}`,
    expected: `Answer ${i}`,
  }));

describe("given two datasets where the active one is not the first", () => {
  const twoDatasetState = (): Pick<
    EvaluationsV3State,
    "datasets" | "activeDatasetId" | "targets" | "evaluators"
  > => ({
    datasets: [
      { id: "dataset-old", name: "Old" },
      { id: "dataset-active", name: "Active" },
    ] as EvaluationsV3State["datasets"],
    activeDatasetId: "dataset-active",
    targets: [
      {
        id: "target-1",
        type: "prompt",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          "dataset-active": {
            input: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-active",
              sourceField: "question",
            },
          },
        },
      },
    ] as EvaluationsV3State["targets"],
    evaluators: [
      {
        id: "eval-1",
        evaluatorType: "langevals/exact_match",
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        mappings: {
          "dataset-active": {
            "target-1": {
              output: {
                type: "source",
                source: "target",
                sourceId: "target-1",
                sourceField: "output",
              },
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-active",
                sourceField: "expected",
              },
            },
          },
        },
      },
    ] as EvaluationsV3State["evaluators"],
  });

  describe("when the run builds its cells", () => {
    /** @scenario "The run reads its mappings from the dataset the rows come from" */
    it("reads the mapping bucket of the active dataset", () => {
      const cells = generateCells(twoDatasetState(), createTestDataset(1), {
        type: "full",
      });

      expect(cells).toHaveLength(1);
      expect(cells[0]?.datasetEntry._datasetId).toBe("dataset-active");
    });

    /** @scenario "The run reads its mappings from the dataset the rows come from" */
    it("resolves the evaluator's inputs instead of dispatching an empty payload", () => {
      const cells = generateCells(twoDatasetState(), createTestDataset(1), {
        type: "full",
      });

      expect(buildEvaluatorInputs(cells[0]!, "eval-1", { output: "Answer 0" })).toEqual({
        output: "Answer 0",
        expected_output: "Answer 0",
      });
    });
  });
});
