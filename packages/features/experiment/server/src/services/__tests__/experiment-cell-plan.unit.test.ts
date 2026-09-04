/**
 * Cell generation: turning a workbench state + a run scope into the
 * concrete list of cells a run executes.
 * @see specs/experiments-v3/evaluation-execution.feature
 */
import { describe, expect, it } from "vitest";
import type { EvaluationsV3State, ExecutionScope } from "@langwatch/experiment-contract";
import { ExperimentCellPlanService } from "../experiment-cell-plan.service";

const cellPlan = ExperimentCellPlanService.create();
const generateCells = (
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">,
  datasetRows: Array<Record<string, unknown>>,
  scope: ExecutionScope,
) => cellPlan.generateCells({ state, datasetRows, scope });

// Helper to create test state (partial state with just what generateCells needs)
const createTestState = ({
  targetCount,
  evaluatorCount,
}: {
  targetCount: number;
  evaluatorCount: number;
}): Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators"> => ({
  datasets: [
    {
      id: "dataset-1",
      name: "Test Dataset",
    } as EvaluationsV3State["datasets"][0],
  ],
  activeDatasetId: "dataset-1",
  targets: Array.from({ length: targetCount }, (_, i) => ({
    id: `target-${i + 1}`,
    type: "prompt" as const,
    name: `Target ${i + 1}`,
    inputs: [{ identifier: "input", type: "str" as const }],
    outputs: [{ identifier: "output", type: "str" as const }],
    mappings: {
      "dataset-1": {
        input: {
          type: "source",
          source: "dataset",
          sourceId: "dataset-1",
          sourceField: "question",
        },
      },
    },
    localPromptConfig: {
      llm: { model: "openai/gpt-5-mini", temperature: 0 },
      messages: [{ role: "user" as const, content: "{{input}}" }],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
  })) as EvaluationsV3State["targets"],
  evaluators: Array.from({ length: evaluatorCount }, (_, i) => ({
    id: `eval-${i + 1}`,
    evaluatorType: "langevals/exact_match" as const,
    name: `Evaluator ${i + 1}`,
    settings: {},
    inputs: [
      { identifier: "output", type: "str" as const },
      { identifier: "expected_output", type: "str" as const },
    ],
    mappings: {},
  })) as EvaluationsV3State["evaluators"],
});

const createTestDataset = (rowCount = 3) =>
  Array.from({ length: rowCount }, (_, i) => ({
    question: `Question ${i}`,
    expected: `Answer ${i}`,
  }));

describe("generateCells with evaluator-all-rows scope", () => {
  /** @scenario "Running evaluator on all rows creates one execution per row with target output" */
  it("creates one cell per row that has a pre-computed target output", () => {
    const state = createTestState({ targetCount: 1, evaluatorCount: 2 });
    const datasetRows = createTestDataset(4);
    const scope: ExecutionScope = {
      type: "evaluator-all-rows",
      targetId: "target-1",
      evaluatorId: "eval-1",
      precomputedTargetOutputs: {
        0: { output: "result-0" },
        1: { output: "result-1" },
        3: { output: "result-3" },
      },
      traceIds: {
        0: "trace-0",
        1: "trace-1",
        3: "trace-3",
      },
    };

    const cells = generateCells(state, datasetRows, scope);

    // Only rows 0, 1, 3 have outputs - row 2 is skipped
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.rowIndex)).toEqual([0, 1, 3]);
  });

  /** @scenario "Running evaluator on all rows creates one execution per row with target output" */
  it("skips target execution for each cell", () => {
    const state = createTestState({ targetCount: 1, evaluatorCount: 1 });
    const datasetRows = createTestDataset(2);
    const scope: ExecutionScope = {
      type: "evaluator-all-rows",
      targetId: "target-1",
      evaluatorId: "eval-1",
      precomputedTargetOutputs: {
        0: { output: "result-0" },
        1: { output: "result-1" },
      },
      traceIds: {},
    };

    const cells = generateCells(state, datasetRows, scope);

    for (const cell of cells) {
      expect(cell.skipTarget).toBe(true);
    }
  });
});
