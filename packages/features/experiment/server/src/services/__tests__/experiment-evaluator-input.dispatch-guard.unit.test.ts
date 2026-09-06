/**
 * The dispatch guard: an evaluator handed nothing to read reports that, rather
 * than comparing empty to empty and reporting a pass that counts.
 * @see specs/experiments-v3/evaluation-execution.feature
 */
import { describe, expect, it } from "vitest";
import type { EvaluatorConfig, ExecutionCell } from "@langwatch/experiment-contract";
import { ExperimentEvaluatorInputService } from "../experiment-evaluator-input.service.ts";
import type { LoadedEvaluators } from "../experiment-execution-data.service.ts";

const guard = ExperimentEvaluatorInputService.create({});

const scoringEvaluator = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "eval-1",
    evaluatorType: "langevals/exact_match",
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    mappings: {},
    ...overrides,
  }) as unknown as EvaluatorConfig;

const cellFor = (
  evaluator: EvaluatorConfig,
  overrides: Partial<ExecutionCell> = {},
): ExecutionCell =>
  ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: {
      id: "target-1",
      type: "prompt",
      inputs: [],
      outputs: [],
      mappings: {},
    },
    evaluatorConfigs: [evaluator],
    datasetEntry: { _datasetId: "dataset-1" },
    ...overrides,
  }) as unknown as ExecutionCell;

describe("given an evaluator that reads fields off the row", () => {
  describe("when no mapping resolved a value", () => {
    /** @scenario "An evaluator with no resolved inputs reports an error instead of a pass" */
    it.each([
      { name: "nothing was written at all", inputs: {} },
      {
        name: "every field is blank, null or absent",
        inputs: { output: "   ", expected_output: null, extra: undefined },
      },
    ])("reports the dispatch as carrying nothing when $name", ({ inputs }) => {
      const evaluator = scoringEvaluator();

      expect(guard.hasNoResolvedInputs({ cell: cellFor(evaluator), evaluator, inputs })).toBe(true);
    });
  });

  describe("when one field resolved", () => {
    /** @scenario "An evaluator with no resolved inputs reports an error instead of a pass" */
    it.each([
      { name: "text in one field", inputs: { output: "hello", expected_output: "" } },
      { name: "a falsy but present value", inputs: { output: 0, expected_output: false } },
    ])("lets the dispatch through for $name", ({ inputs }) => {
      const evaluator = scoringEvaluator();

      expect(guard.hasNoResolvedInputs({ cell: cellFor(evaluator), evaluator, inputs })).toBe(
        false,
      );
    });
  });

  describe("when the evaluator declares no field at all", () => {
    /** @scenario "An evaluator with no resolved inputs reports an error instead of a pass" */
    it("has nothing to be missing and dispatches", () => {
      const evaluator = scoringEvaluator({ inputs: [], evaluatorType: "custom/none" });

      expect(guard.hasNoResolvedInputs({ cell: cellFor(evaluator), evaluator, inputs: {} })).toBe(
        false,
      );
    });
  });
});

describe("given a comparison cell", () => {
  const comparisonEvaluator = scoringEvaluator({
    id: "cmp-eval",
    evaluatorType: "langevals/select_best_compare",
    inputs: [],
    comparison: {
      variants: ["target-1", "target-2"],
      hasGoldenAnswer: false,
      goldenField: "",
      includeMetrics: [],
      randomizeOrder: true,
    },
  });

  describe("when at least one candidate carries text", () => {
    /** @scenario "An evaluator with no resolved inputs reports an error instead of a pass" */
    it("judges on the candidates rather than the input map", () => {
      const cell = cellFor(comparisonEvaluator, {
        comparison: {
          candidates: [
            { id: "a", output: "answer from A" },
            { id: "b", output: "" },
          ],
        },
      });

      expect(
        guard.hasNoResolvedInputs({
          cell,
          evaluator: comparisonEvaluator,
          inputs: guard.buildEvaluatorInputs({ cell, evaluatorId: "cmp-eval", targetOutput: {} }),
        }),
      ).toBe(false);
    });
  });

  describe("when no candidate carries text", () => {
    /** @scenario "An evaluator with no resolved inputs reports an error instead of a pass" */
    it("reports the dispatch as carrying nothing", () => {
      const cell = cellFor(comparisonEvaluator, {
        comparison: {
          candidates: [
            { id: "a", output: "" },
            { id: "b", output: "" },
          ],
        },
      });

      expect(guard.hasNoResolvedInputs({ cell, evaluator: comparisonEvaluator, inputs: {} })).toBe(
        true,
      );
    });
  });
});

describe("given an evaluator that is its own column", () => {
  const evaluatorColumn = (overrides: Record<string, unknown> = {}) =>
    ({
      rowIndex: 0,
      targetId: "column-1",
      targetConfig: {
        id: "column-1",
        type: "evaluator",
        targetEvaluatorId: "db-eval",
        inputs: [{ identifier: "output", type: "str" }],
        outputs: [],
        mappings: {
          "dataset-1": {
            output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "answer",
            },
          },
        },
      },
      evaluatorConfigs: [],
      datasetEntry: { _datasetId: "dataset-1" },
      ...overrides,
    }) as unknown as ExecutionCell;

  describe("when the column it reads holds nothing", () => {
    /** @scenario "An evaluator column with no resolved inputs reports an error instead of passing" */
    it("reports the dispatch as carrying nothing", () => {
      expect(guard.evaluatorTargetHasNoResolvedInputs({ cell: evaluatorColumn() })).toBe(true);
    });
  });

  describe("when the column it reads holds a value", () => {
    /** @scenario "An evaluator column with no resolved inputs reports an error instead of passing" */
    it("lets the dispatch through", () => {
      const cell = evaluatorColumn({
        datasetEntry: { _datasetId: "dataset-1", answer: "the answer" },
      });

      expect(guard.evaluatorTargetHasNoResolvedInputs({ cell })).toBe(false);
    });
  });

  describe("when the cell already has its answer, or is a comparison", () => {
    /** @scenario "An evaluator column with no resolved inputs reports an error instead of passing" */
    it.each([
      { name: "the target was skipped for a carried-over answer", overrides: { skipTarget: true } },
      {
        name: "the cell is a comparison judged on its candidates",
        overrides: { comparison: { candidates: [{ id: "a", output: "answer" }] } },
      },
    ])("does not guard it when $name", ({ overrides }) => {
      expect(guard.evaluatorTargetHasNoResolvedInputs({ cell: evaluatorColumn(overrides) })).toBe(
        false,
      );
    });
  });

  describe("when the row has to say which column had nothing to read", () => {
    const loadedEvaluators: LoadedEvaluators = new Map([
      ["db-eval", { id: "db-eval", name: "Exact Match", config: {} }],
    ]);

    /** @scenario "The cell says which evaluator had nothing to read" */
    it("names the evaluator behind the column rather than its id", () => {
      const named = ExperimentEvaluatorInputService.create({ loadedEvaluators });

      expect(named.evaluatorTargetDisplayName({ target: evaluatorColumn().targetConfig })).toBe(
        "Exact Match",
      );
    });

    /** @scenario "The cell says which evaluator had nothing to read" */
    it("falls back to the column's own id when nothing names it", () => {
      expect(guard.evaluatorTargetDisplayName({ target: evaluatorColumn().targetConfig })).toBe(
        "column-1",
      );
    });
  });
});
