/**
 * What a run's scope plans: which rows it touches, which columns it runs, what
 * each cell carries, and the order the cells come out in.
 * @see specs/experiments-v3/execution-backend.feature
 */
import { describe, expect, it } from "vitest";
import type {
  EvaluationsV3State,
  EvaluatorConfig,
  ExecutionScope,
  TargetConfig,
} from "@langwatch/experiment-contract";
import { ExperimentCellPlanService } from "../experiment-cell-plan.service.ts";

const cellPlan = ExperimentCellPlanService.create();

type PlanState = Pick<
  EvaluationsV3State,
  "datasets" | "activeDatasetId" | "targets" | "evaluators"
>;

const stateWith = ({
  targetCount,
  evaluatorCount,
}: {
  targetCount: number;
  evaluatorCount: number;
}): PlanState => ({
  datasets: [{ id: "dataset-1", name: "Test Dataset" } as PlanState["datasets"][0]],
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
  })) as PlanState["targets"],
  evaluators: Array.from({ length: evaluatorCount }, (_, i) => ({
    id: `eval-${i + 1}`,
    evaluatorType: "langevals/exact_match" as const,
    name: `Evaluator ${i + 1}`,
    settings: {},
    inputs: [{ identifier: "output", type: "str" as const }],
    mappings: {},
  })) as PlanState["evaluators"],
});

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ question: `Question ${i}`, expected: `Answer ${i}` }));

const comparisonEvaluator = {
  id: "comparison-eval",
  evaluatorType: "langevals/select_best_compare",
  inputs: [{ identifier: "candidates", type: "str" }],
  mappings: {},
  comparison: {
    variants: ["target-1", "target-2"],
    hasGoldenAnswer: true,
    goldenField: "expected",
    includeMetrics: [],
    randomizeOrder: true,
  },
} as unknown as EvaluatorConfig;

const comparisonTarget = {
  id: "comparison-target",
  type: "evaluator",
  targetEvaluatorId: "db-select-best-evaluator",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "label", type: "str" }],
  mappings: {},
  comparison: {
    variants: ["target-1", "target-2"],
    hasGoldenAnswer: true,
    goldenField: "expected",
    includeMetrics: [],
    randomizeOrder: true,
  },
} as unknown as TargetConfig;

const plan = (
  state: PlanState,
  datasetRows: Array<Record<string, unknown>>,
  scope: ExecutionScope,
) => cellPlan.generateCells({ state, datasetRows, scope });

describe("given a run scope over a dataset", () => {
  describe("when the rows it may touch are resolved", () => {
    /** @scenario "A run's scope decides which rows it may touch" */
    it.each([
      { name: "a full run", scope: { type: "full" } as ExecutionScope, expected: [0, 1, 2, 3] },
      {
        name: "a whole-column run",
        scope: { type: "target", targetId: "target-1" } as ExecutionScope,
        expected: [0, 1, 2, 3],
      },
      {
        name: "a run over the rows the user picked",
        scope: { type: "rows", rowIndices: [2, 0] } as ExecutionScope,
        expected: [2, 0],
      },
      {
        name: "a picked-rows run naming a row twice",
        scope: { type: "rows", rowIndices: [1, 1] } as ExecutionScope,
        expected: [1],
      },
      {
        name: "a picked-rows run reaching past the end",
        scope: { type: "rows", rowIndices: [1, 99, -1] } as ExecutionScope,
        expected: [1],
      },
      {
        name: "a column run pinned to rows",
        scope: { type: "target-rows", targetIds: ["target-1"], rowIndices: [3] } as ExecutionScope,
        expected: [3],
      },
      {
        name: "a column run with no rows named",
        scope: { type: "target-rows", targetIds: ["target-1"] } as ExecutionScope,
        expected: [0, 1, 2, 3],
      },
      {
        name: "a single cell",
        scope: { type: "cell", rowIndex: 2, targetId: "target-1" } as ExecutionScope,
        expected: [2],
      },
      {
        name: "a cell whose row no longer exists",
        scope: { type: "cell", rowIndex: 9, targetId: "target-1" } as ExecutionScope,
        expected: [],
      },
    ])("resolves $name to its rows", ({ scope, expected }) => {
      expect(cellPlan.resolveScopedRowIndices({ scope, rowCount: 4 })).toEqual(expected);
    });
  });

  describe("when the cells are planned", () => {
    /** @scenario "A run plans one cell per scoped row and scoped column" */
    it.each([
      { name: "every row of every column", scope: { type: "full" } as ExecutionScope, cells: 6 },
      {
        name: "every column of one row",
        scope: { type: "rows", rowIndices: [1] } as ExecutionScope,
        cells: 2,
      },
      {
        name: "every row of one column",
        scope: { type: "target", targetId: "target-1" } as ExecutionScope,
        cells: 3,
      },
      {
        name: "the crossing of picked columns and picked rows",
        scope: {
          type: "target-rows",
          targetIds: ["target-2"],
          rowIndices: [0, 2],
        } as ExecutionScope,
        cells: 2,
      },
      {
        name: "one cell",
        scope: { type: "cell", rowIndex: 2, targetId: "target-2" } as ExecutionScope,
        cells: 1,
      },
      {
        name: "nothing for a column that no longer exists",
        scope: { type: "target", targetId: "gone" } as ExecutionScope,
        cells: 0,
      },
    ])("plans $name", ({ scope, cells }) => {
      expect(plan(stateWith({ targetCount: 2, evaluatorCount: 1 }), rows(3), scope)).toHaveLength(
        cells,
      );
    });

    /** @scenario "A run plans one cell per scoped row and scoped column" */
    it("counts the same cells it would run", () => {
      const state = stateWith({ targetCount: 2, evaluatorCount: 1 });
      const scope: ExecutionScope = { type: "full" };

      expect(cellPlan.countScopedCells({ state, datasetRows: rows(3), scope })).toBe(
        plan(state, rows(3), scope).length,
      );
    });

    /** @scenario "A run's cells come out row by row" */
    it("walks the dataset row by row, taking every column before moving on", () => {
      const cells = plan(stateWith({ targetCount: 2, evaluatorCount: 0 }), rows(3), {
        type: "full",
      });

      expect(cells.map((cell) => `${cell.rowIndex}:${cell.targetId}`)).toEqual([
        "0:target-1",
        "0:target-2",
        "1:target-1",
        "1:target-2",
        "2:target-1",
        "2:target-2",
      ]);
    });

    /** @scenario "A cell carries its row and the dataset the row came from" */
    it("hands each cell its row's fields and the dataset they came from", () => {
      const cells = plan(
        stateWith({ targetCount: 1, evaluatorCount: 0 }),
        [{ question: "Hello", expected: "World" }],
        { type: "full" },
      );

      expect(cells[0]?.datasetEntry).toEqual({
        _datasetId: "dataset-1",
        question: "Hello",
        expected: "World",
      });
    });

    /** @scenario "A cell carries its row and the dataset the row came from" */
    it("attaches every scoring evaluator to every cell", () => {
      const cells = plan(stateWith({ targetCount: 1, evaluatorCount: 3 }), rows(1), {
        type: "full",
      });

      expect(cells[0]?.evaluatorConfigs.map((evaluator) => evaluator.id)).toEqual([
        "eval-1",
        "eval-2",
        "eval-3",
      ]);
    });

    /** @scenario "A row with nothing in it is not run" */
    it("skips a row with nothing in it", () => {
      const cells = plan(
        stateWith({ targetCount: 1, evaluatorCount: 0 }),
        [
          { question: "Hello", expected: "World" },
          { question: "", expected: "" },
        ],
        { type: "full" },
      );

      expect(cells.map((cell) => cell.rowIndex)).toEqual([0]);
    });
  });

  describe("when a comparison is part of the workbench", () => {
    /** @scenario "A comparison waits for phase two rather than running per column" */
    it("keeps a comparison evaluator off the per-column cells", () => {
      const state = stateWith({ targetCount: 2, evaluatorCount: 1 });
      state.evaluators.push(comparisonEvaluator);

      const cells = plan(state, rows(1), { type: "full" });

      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        expect(cell.evaluatorConfigs.map((evaluator) => evaluator.id)).toEqual(["eval-1"]);
      }
    });

    /** @scenario "A comparison waits for phase two rather than running per column" */
    it("plans no phase-one cell for a comparison column", () => {
      const state = stateWith({ targetCount: 2, evaluatorCount: 0 });
      state.targets.push(comparisonTarget);

      const cells = plan(state, rows(1), { type: "full" });

      expect(cells.map((cell) => cell.targetId)).toEqual(["target-1", "target-2"]);
    });

    /** @scenario "Re-running a comparison does not re-run the columns it already has" */
    it("pulls in a comparison's columns when the run is scoped to it", () => {
      const state = stateWith({ targetCount: 2, evaluatorCount: 0 });
      state.targets.push(comparisonTarget);

      const cells = cellPlan.generateCells({
        state,
        datasetRows: rows(1),
        scope: { type: "cell", rowIndex: 0, targetId: "comparison-target" },
      });

      expect(cells.map((cell) => cell.targetId)).toEqual(["target-1", "target-2"]);
    });

    /** @scenario "Re-running a comparison does not re-run the columns it already has" */
    it("leaves a column alone when this row's output was carried over", () => {
      const state = stateWith({ targetCount: 2, evaluatorCount: 0 });
      state.targets.push(comparisonTarget);

      const cells = cellPlan.generateCells({
        state,
        datasetRows: rows(1),
        scope: { type: "cell", rowIndex: 0, targetId: "comparison-target" },
        seedTargetOutputs: { "0:target-1": { output: "already answered" } },
      });

      expect(cells.map((cell) => cell.targetId)).toEqual(["target-2"]);
    });
  });
});

describe("given one evaluator re-run over rows that already have outputs", () => {
  const scopeOverRows = (evaluatorId: string): ExecutionScope => ({
    type: "evaluator-all-rows",
    targetId: "target-1",
    evaluatorId,
    precomputedTargetOutputs: { 0: { output: "result-0" }, 1: { output: "result-1" } },
    traceIds: { 0: "trace-0" },
  });

  describe("when the cells are planned", () => {
    /** @scenario "Re-running one evaluator reuses the outputs already on the row" */
    it("runs only that evaluator against the output already on the row", () => {
      const cells = plan(
        stateWith({ targetCount: 1, evaluatorCount: 2 }),
        rows(2),
        scopeOverRows("eval-2"),
      );

      expect(cells.map((cell) => cell.evaluatorConfigs.map((e) => e.id))).toEqual([
        ["eval-2"],
        ["eval-2"],
      ]);
      expect(cells.map((cell) => cell.precomputedTargetOutput)).toEqual([
        { output: "result-0" },
        { output: "result-1" },
      ]);
      expect(cells.map((cell) => cell.traceId)).toEqual(["trace-0", undefined]);
    });

    /** @scenario "Re-running one evaluator reuses the outputs already on the row" */
    it.each([
      { name: "an evaluator that no longer exists", evaluatorId: "gone" },
      { name: "a comparison evaluator that needs every column", evaluatorId: "comparison-eval" },
    ])("plans nothing for $name", ({ evaluatorId }) => {
      const state = stateWith({ targetCount: 1, evaluatorCount: 1 });
      state.evaluators.push(comparisonEvaluator);

      expect(plan(state, rows(2), scopeOverRows(evaluatorId))).toHaveLength(0);
    });
  });
});
