/**
 * Cell generation: turning a workbench state + a run scope into the concrete
 * list of cells a run executes.
 *
 * @see specs/experiments-v3/evaluation-execution.feature
 * @see specs/experiments/comparison-leaderboard.feature
 */
import { describe, expect, it } from "vitest";
import type { EvaluationsV3State, ExecutionScope } from "@langwatch/experiment-contract";
import {
  buildEvaluatorInputs,
  comparisonSkipMessage,
  generateCells,
  generateComparisonCells,
} from "../experiment-run-orchestrator.service";

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
    mappings: {
      "dataset-1": {
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
            sourceId: "dataset-1",
            sourceField: "expected",
          },
        },
        "target-2": {
          output: {
            type: "source",
            source: "target",
            sourceId: "target-2",
            sourceField: "output",
          },
          expected_output: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "expected",
          },
        },
      },
    },
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

describe("generateComparisonCells given a comparison the user has not finished configuring", () => {
  const columnTarget = (
    comparison: Record<string, unknown>,
  ): EvaluationsV3State["targets"][0] =>
    ({
      id: "comparison-column",
      type: "evaluator",
      targetEvaluatorId: "db-comparison-evaluator",
      inputs: [],
      outputs: [{ identifier: "label", type: "str" }],
      mappings: {},
      comparison,
    }) as unknown as EvaluationsV3State["targets"][0];

  const runWith = (target: EvaluationsV3State["targets"][0]) => {
    const state = createTestState({ targetCount: 2, evaluatorCount: 0 });
    state.targets.push(target);
    return generateComparisonCells({
      scopedRowIndices: undefined,
      state,
      datasetRows: createTestDataset(2),
      completedTargetOutputs: new Map([
        ["0:target-1", { output: { output: "answer from A" } }],
        ["0:target-2", { output: { output: "answer from B" } }],
        ["1:target-1", { output: { output: "answer from A" } }],
        ["1:target-2", { output: { output: "answer from B" } }],
      ]),
    });
  };

  describe("when fewer than two columns are picked", () => {
    /** @scenario "A comparison the user has not finished configuring says what to fix" */
    it("reports every scoped row instead of skipping in silence", () => {
      const { cells, skipReasons } = runWith(
        columnTarget({
          variants: ["target-1"],
          hasGoldenAnswer: false,
          goldenField: "",
          includeMetrics: [],
          randomizeOrder: true,
        }),
      );

      expect(cells).toHaveLength(0);
      expect(skipReasons.map((r) => r.rowIndex)).toEqual([0, 1]);
      expect(skipReasons[0]?.kind).toBe("too-few-variants");
      expect(skipReasons[0]?.targetId).toBe("comparison-column");
      expect(comparisonSkipMessage(skipReasons[0]!).errorType).toBe(
        "TooFewComparisonVariants",
      );
    });
  });

  describe("when the golden answer is on but no column is picked for it", () => {
    /** @scenario "A comparison the user has not finished configuring says what to fix" */
    it("reports the golden field as the thing to fix", () => {
      const { cells, skipReasons } = runWith(
        columnTarget({
          variants: ["target-1", "target-2"],
          hasGoldenAnswer: true,
          goldenField: "",
          includeMetrics: [],
          randomizeOrder: true,
        }),
      );

      expect(cells).toHaveLength(0);
      expect(skipReasons).toHaveLength(2);
      expect(skipReasons[0]?.kind).toBe("golden-not-set");
      expect(comparisonSkipMessage(skipReasons[0]!).errorType).toBe("GoldenFieldNotSet");
    });
  });

  describe("when a picked column no longer exists", () => {
    /** @scenario "A comparison the user has not finished configuring says what to fix" */
    it("reports the missing column rather than judging what is left", () => {
      const { cells, skipReasons } = runWith(
        columnTarget({
          variants: ["target-1", "target-deleted"],
          hasGoldenAnswer: false,
          goldenField: "",
          includeMetrics: [],
          randomizeOrder: true,
        }),
      );

      expect(cells).toHaveLength(0);
      expect(skipReasons).toHaveLength(2);
      expect(skipReasons[0]?.kind).toBe("variant-not-found");
      expect(comparisonSkipMessage(skipReasons[0]!).errorType).toBe(
        "ComparisonVariantNotFound",
      );
    });
  });

  describe("when the carrier is a chip evaluator on a variant column", () => {
    /** @scenario "A comparison the user has not finished configuring says what to fix" */
    it("anchors the error on the first column it still has", () => {
      const state = createTestState({ targetCount: 2, evaluatorCount: 0 });
      state.evaluators.push({
        id: "eval-chip-comparison",
        evaluatorType: "langevals/select_best_compare",
        inputs: [],
        mappings: {},
        comparison: {
          variants: ["target-2"],
          hasGoldenAnswer: false,
          goldenField: "",
          includeMetrics: [],
          randomizeOrder: true,
        },
      } as unknown as EvaluationsV3State["evaluators"][0]);

      const { cells, skipReasons } = generateComparisonCells({
        scopedRowIndices: [1],
        state,
        datasetRows: createTestDataset(2),
        completedTargetOutputs: new Map(),
      });

      expect(cells).toHaveLength(0);
      expect(skipReasons).toHaveLength(1);
      expect(skipReasons[0]?.rowIndex).toBe(1);
      expect(skipReasons[0]?.targetId).toBe("target-2");
      expect(skipReasons[0]?.evaluatorId).toBe("eval-chip-comparison");
    });
  });
});

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
