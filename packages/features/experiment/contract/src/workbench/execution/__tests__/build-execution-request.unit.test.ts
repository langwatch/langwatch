import { describe, expect, it } from "vitest";
import type {
  DatasetReference,
  EvaluatorConfig,
  TargetConfig,
} from "../../../experiment-workbench";
import type { ExecutionScope } from "../types";
import {
  buildExecutionRequest,
  comparisonDependencies,
  type ExecutionRequestState,
  planComparisonSeeding,
} from "../build-execution-request";

const dataset = (): DatasetReference => ({
  id: "ds-1",
  name: "Test Data",
  type: "inline",
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
  inline: {
    columns: [
      { id: "input", name: "input", type: "string" },
      { id: "expected_output", name: "expected_output", type: "string" },
    ],
    records: {
      input: ["one", "two"],
      expected_output: ["1", "2"],
    },
  },
});

const promptTarget = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  promptId: "prompt-1",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    "ds-1": {
      input: {
        type: "source",
        source: "dataset",
        sourceId: "ds-1",
        sourceField: "input",
      },
    },
  },
});

/** The chip shape: a comparison evaluator whose variants are plain columns. */
const comparisonChip = (): EvaluatorConfig => ({
  id: "evaluator_compare",
  evaluatorType: "langevals/select_best_compare",
  inputs: [],
  mappings: {},
  comparison: {
    variants: ["baseline", "candidate"],
    hasGoldenAnswer: true,
    goldenField: "expected_output",
    includeMetrics: [],
    randomizeOrder: true,
  },
});

/** The column shape: an evaluator target that carries the comparison itself. */
const comparisonColumn = (): TargetConfig => ({
  ...promptTarget("compare-column"),
  type: "evaluator",
  targetEvaluatorId: "db-compare-1",
  comparison: {
    variants: ["baseline", "candidate"],
    hasGoldenAnswer: true,
    goldenField: "expected_output",
    includeMetrics: [],
    randomizeOrder: true,
  },
});

const baseState = (): ExecutionRequestState => ({
  name: "My Evaluation",
  datasets: [dataset()],
  activeDatasetId: "ds-1",
  targets: [promptTarget("baseline"), promptTarget("candidate")],
  evaluators: [],
  experimentId: "experiment-1",
  experimentSlug: "my-evaluation",
});

const savedBaselineOutputs = () => ({
  targetOutputs: { baseline: ["baseline one", "baseline two"] },
  targetMetadata: {
    baseline: [
      { cost: 0.01, duration: 100 },
      { cost: 0.02, duration: 200 },
    ],
  },
});

const candidateOnly: ExecutionScope = {
  type: "target",
  targetId: "candidate",
};

describe("comparisonDependencies", () => {
  describe("given a chip comparison over two columns", () => {
    describe("when one of its variants is named", () => {
      /** @scenario "Running one candidate keeps the comparison's other columns" */
      it("names the other variant", () => {
        expect(
          comparisonDependencies({
            targets: baseState().targets,
            evaluators: [comparisonChip()],
            targetId: "candidate",
          }),
        ).toEqual(["baseline"]);
      });
    });

    describe("when a column no comparison names is named", () => {
      it("names nothing", () => {
        expect(
          comparisonDependencies({
            targets: [...baseState().targets, promptTarget("unrelated")],
            evaluators: [comparisonChip()],
            targetId: "unrelated",
          }),
        ).toEqual([]);
      });
    });
  });

  describe("given a comparison column", () => {
    describe("when the comparison column itself is named", () => {
      it("names every column it judges", () => {
        expect(
          comparisonDependencies({
            targets: [...baseState().targets, comparisonColumn()],
            evaluators: [],
            targetId: "compare-column",
          }),
        ).toEqual(["baseline", "candidate"]);
      });
    });
  });
});

describe("planComparisonSeeding", () => {
  describe("given a candidate-only run and a chip comparison", () => {
    describe("when the other variant has saved output", () => {
      /** @scenario "Running one candidate keeps the comparison's other columns" */
      it("seeds every row of it rather than running it again", () => {
        const plan = planComparisonSeeding({
          targets: baseState().targets,
          evaluators: [comparisonChip()],
          scope: candidateOnly,
          rowCount: 2,
          results: savedBaselineOutputs(),
        });

        expect(plan.seedTargetOutputs).toEqual({
          "0:baseline": {
            output: "baseline one",
            cost: 0.01,
            duration: 100,
          },
          "1:baseline": {
            output: "baseline two",
            cost: 0.02,
            duration: 200,
          },
        });
        expect(plan.extraCells).toEqual([]);
      });
    });

    describe("when the other variant has no saved output", () => {
      /** @scenario "Running one candidate keeps the comparison's other columns" */
      it("adds its cells to the run instead of seeding them", () => {
        const plan = planComparisonSeeding({
          targets: baseState().targets,
          evaluators: [comparisonChip()],
          scope: candidateOnly,
          rowCount: 2,
        });

        expect(plan.seedTargetOutputs).toEqual({});
        expect(plan.extraCells).toEqual([
          { rowIndex: 0, targetId: "baseline" },
          { rowIndex: 1, targetId: "baseline" },
        ]);
      });
    });

    describe("when only one row of the other variant has saved output", () => {
      it("seeds that row and runs the rest", () => {
        const plan = planComparisonSeeding({
          targets: baseState().targets,
          evaluators: [comparisonChip()],
          scope: candidateOnly,
          rowCount: 2,
          results: {
            targetOutputs: { baseline: ["baseline one"] },
            targetMetadata: {},
          },
        });

        expect(Object.keys(plan.seedTargetOutputs)).toEqual(["0:baseline"]);
        expect(plan.extraCells).toEqual([{ rowIndex: 1, targetId: "baseline" }]);
      });
    });
  });

  describe("given a run of the comparison column itself", () => {
    /** @scenario "Running one candidate keeps the comparison's other columns" */
    it("seeds the variants it judges", () => {
      const plan = planComparisonSeeding({
        targets: [...baseState().targets, comparisonColumn()],
        evaluators: [],
        scope: { type: "target", targetId: "compare-column" },
        rowCount: 2,
        results: savedBaselineOutputs(),
      });

      expect(Object.keys(plan.seedTargetOutputs)).toEqual(["0:baseline", "1:baseline"]);
      expect(plan.extraCells).toEqual([
        { rowIndex: 0, targetId: "candidate" },
        { rowIndex: 1, targetId: "candidate" },
      ]);
    });
  });

  describe("given a run that already covers both variants", () => {
    it("seeds nothing, because the run produces both outputs itself", () => {
      const plan = planComparisonSeeding({
        targets: baseState().targets,
        evaluators: [comparisonChip()],
        scope: { type: "target-rows", targetIds: ["baseline", "candidate"] },
        rowCount: 2,
        results: savedBaselineOutputs(),
      });

      expect(plan.seedTargetOutputs).toEqual({});
      expect(plan.extraCells).toEqual([]);
    });
  });

  describe("given a full run", () => {
    it("seeds nothing, because every column runs", () => {
      const plan = planComparisonSeeding({
        targets: baseState().targets,
        evaluators: [comparisonChip()],
        scope: { type: "full" },
        rowCount: 2,
        results: savedBaselineOutputs(),
      });

      expect(plan.seedTargetOutputs).toEqual({});
      expect(plan.extraCells).toEqual([]);
    });
  });

  describe("given a single-cell run of one candidate", () => {
    it("seeds only that row of the other variant", () => {
      const plan = planComparisonSeeding({
        targets: baseState().targets,
        evaluators: [comparisonChip()],
        scope: { type: "cell", targetId: "candidate", rowIndex: 1 },
        rowCount: 2,
        results: savedBaselineOutputs(),
      });

      expect(Object.keys(plan.seedTargetOutputs)).toEqual(["1:baseline"]);
    });
  });
});

describe("buildExecutionRequest", () => {
  describe("given a workbench with two columns", () => {
    describe("when the run covers everything", () => {
      it("carries the state the engine needs and no seeds", () => {
        const built = buildExecutionRequest({
          state: baseState(),
          projectId: "project-1",
          scope: { type: "full" },
          concurrency: 4,
        });

        expect(built?.request.projectId).toBe("project-1");
        expect(built?.request.experimentId).toBe("experiment-1");
        expect(built?.request.experimentSlug).toBe("my-evaluation");
        expect(built?.request.name).toBe("My Evaluation");
        expect(built?.request.dataset.id).toBe("ds-1");
        expect(built?.request.concurrency).toBe(4);
        expect(built?.request.seedTargetOutputs).toBeUndefined();
        expect(built?.executionCells).toHaveLength(4);
      });
    });

    describe("when the workbench has no dataset", () => {
      it("builds nothing", () => {
        const state = baseState();
        state.datasets = [];

        expect(
          buildExecutionRequest({
            state,
            projectId: "project-1",
            scope: { type: "full" },
          }),
        ).toBeNull();
      });
    });
  });

  describe("given a chip comparison and a candidate-only run", () => {
    /** @scenario "Running one candidate keeps the comparison's other columns" */
    it("sends the saved baseline output as a seed", () => {
      const state = baseState();
      state.evaluators = [comparisonChip()];
      state.results = savedBaselineOutputs();

      const built = buildExecutionRequest({
        state,
        projectId: "project-1",
        scope: candidateOnly,
      });

      expect(built?.request.seedTargetOutputs).toEqual({
        "0:baseline": { output: "baseline one", cost: 0.01, duration: 100 },
        "1:baseline": { output: "baseline two", cost: 0.02, duration: 200 },
      });
      // The page counts only the candidate's own cells: the baseline is reused,
      // not run.
      expect(built?.executionCells).toEqual([
        { rowIndex: 0, targetId: "candidate" },
        { rowIndex: 1, targetId: "candidate" },
      ]);
    });

    /** @scenario "Running one candidate keeps the comparison's other columns" */
    it("counts the baseline's cells when there is nothing to reuse", () => {
      const state = baseState();
      state.evaluators = [comparisonChip()];

      const built = buildExecutionRequest({
        state,
        projectId: "project-1",
        scope: candidateOnly,
      });

      expect(built?.request.seedTargetOutputs).toBeUndefined();
      expect(built?.executionCells).toEqual([
        { rowIndex: 0, targetId: "candidate" },
        { rowIndex: 1, targetId: "candidate" },
        { rowIndex: 0, targetId: "baseline" },
        { rowIndex: 1, targetId: "baseline" },
      ]);
    });
  });

  describe("given a legacy pairwise config", () => {
    it("puts the canonical comparison shape on the wire", () => {
      const state = baseState();
      state.evaluators = [
        {
          id: "evaluator_compare",
          evaluatorType: "langevals/pairwise_compare",
          inputs: [],
          mappings: {},
          pairwise: {
            variantA: "baseline",
            variantB: "candidate",
            hasGoldenAnswer: true,
            goldenField: "expected_output",
            includeMetrics: [],
          },
        },
      ];

      const built = buildExecutionRequest({
        state,
        projectId: "project-1",
        scope: { type: "full" },
      });

      expect(built?.request.evaluators[0]?.comparison?.variants).toEqual(["baseline", "candidate"]);
    });
  });
});
