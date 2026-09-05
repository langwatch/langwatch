/**
 * Phase 2 cell generation: comparisons the user has not finished
 * configuring.
 * @see specs/experiments/comparison-leaderboard.feature
 */
import { describe, expect, it } from "vitest";
import type { EvaluationsV3State } from "@langwatch/experiment-contract";
import { ExperimentRunOrchestratorService } from "../experiment-run-orchestrator.service";

// Helper to create test state (partial state with just what ExperimentRunOrchestratorService.generateCells needs)
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

describe("ExperimentRunOrchestratorService.generateComparisonCells given a comparison the user has not finished configuring", () => {
  const columnTarget = (comparison: Record<string, unknown>): EvaluationsV3State["targets"][0] =>
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
    return ExperimentRunOrchestratorService.generateComparisonCells({
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
      expect(
        ExperimentRunOrchestratorService.comparisonSkipMessage(skipReasons[0]!).errorType,
      ).toBe("TooFewComparisonVariants");
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
      expect(
        ExperimentRunOrchestratorService.comparisonSkipMessage(skipReasons[0]!).errorType,
      ).toBe("GoldenFieldNotSet");
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
      expect(
        ExperimentRunOrchestratorService.comparisonSkipMessage(skipReasons[0]!).errorType,
      ).toBe("ComparisonVariantNotFound");
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

      const { cells, skipReasons } = ExperimentRunOrchestratorService.generateComparisonCells({
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
