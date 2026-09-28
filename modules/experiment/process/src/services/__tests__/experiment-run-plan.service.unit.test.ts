import {
  COMPARISON_EVALUATOR_TYPE,
  type ComparisonEvaluatorConfig,
  type DatasetReference,
  type EvaluatorConfig,
  type ExecutionScope,
  type TargetConfig,
} from "@langwatch/experiment-contract";
/**
 * The plan a run starts with: its target cells, then the comparison cells its configuration asks
 * for, with their setup skips, its rows once each and the versions it pins.
 * @see modules/experiment/specs/experiment-run-loop.feature
 */
import { describe, expect, it } from "vitest";

import { comparisonStateOf, planDatasetRows } from "../../rules/experiment-run-plan.rules.ts";
import { ExperimentComparisonPlanService } from "../experiment-comparison-plan.service.ts";
import {
  type ExperimentRunPlanData,
  type ExperimentRunPlanRequest,
  ExperimentRunPlanService,
} from "../experiment-run-plan.service.ts";

const dataset = (id: string): DatasetReference => ({
  id,
  name: id,
  type: "inline",
  columns: [
    { id: "question", name: "question", type: "string" },
    { id: "expected", name: "expected", type: "string" },
  ],
});

const promptTarget: TargetConfig = {
  id: "target_a",
  type: "prompt",
  promptId: "prompt_a",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
};

const workflowTarget: TargetConfig = {
  id: "target_b",
  type: "workflow",
  workflowId: "workflow_b",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
};

const exactMatch: EvaluatorConfig = {
  id: "exact",
  evaluatorType: "langevals/exact_match",
  inputs: [{ identifier: "output", type: "str" }],
  mappings: {},
};

const comparison = (
  overrides: Partial<ComparisonEvaluatorConfig> = {},
): ComparisonEvaluatorConfig => ({
  variants: ["target_a", "target_b"],
  hasGoldenAnswer: false,
  goldenField: "",
  includeMetrics: [],
  randomizeOrder: false,
  ...overrides,
});

const judge = (config: ComparisonEvaluatorConfig = comparison()): EvaluatorConfig => ({
  id: "judge",
  evaluatorType: COMPARISON_EVALUATOR_TYPE,
  inputs: [],
  mappings: {},
  comparison: config,
});

const columnJudge = (config: ComparisonEvaluatorConfig = comparison()): TargetConfig => ({
  id: "column_judge",
  type: "evaluator",
  targetEvaluatorId: "db_judge",
  inputs: [],
  outputs: [{ identifier: "label", type: "str" }],
  mappings: {},
  comparison: config,
});

/** Row 1 is empty: no target runs it, and a setup skip does not report it. */
const datasetRows = [
  { question: "What is 2 + 2?", expected: "4" },
  { question: "", expected: "" },
  { question: "What is 3 + 3?", expected: "6" },
];

const data: ExperimentRunPlanData = {
  datasetRows,
  datasetColumns: dataset("dataset_1").columns,
  loadedPrompts: new Map([["prompt_a@latest", { id: "prompt_a", version: 7 }]]),
  loadedWorkflows: new Map([["workflow_b::published", { id: "workflow_b", versionId: "wfv_3" }]]),
};

function requestWith({
  scope = { type: "full" },
  targets = [promptTarget, workflowTarget],
  evaluators = [exactMatch, judge()],
  seedTargetOutputs,
}: {
  scope?: ExecutionScope;
  targets?: TargetConfig[];
  evaluators?: EvaluatorConfig[];
  seedTargetOutputs?: ExperimentRunPlanRequest["seedTargetOutputs"];
} = {}): ExperimentRunPlanRequest {
  return {
    state: {
      datasets: [dataset("dataset_0"), dataset("dataset_1")],
      activeDatasetId: "dataset_1",
      targets,
      evaluators,
    },
    scope,
    ...(seedTargetOutputs ? { seedTargetOutputs } : {}),
  };
}

function planOf(request: ExperimentRunPlanRequest) {
  return ExperimentRunPlanService.create().buildPlan({
    request,
    data,
    concurrency: 4,
    origin: "workbench",
    persistResults: true,
    actor: { id: "user_1", label: "user" },
  });
}

describe("ExperimentRunPlanService.buildPlan", () => {
  describe("given a full run over two targets and a chip comparison", () => {
    /** @scenario "A run's plan lists its target cells, then its comparison cells, in one ordinal order" */
    it("lists the target cells row by row, then one comparison cell per row after them", () => {
      const plan = planOf(requestWith());

      expect(plan.cells).toEqual([
        { ordinal: 0, phase: 1, rowIndex: 0, targetId: "target_a", evaluatorIds: ["exact"] },
        { ordinal: 1, phase: 1, rowIndex: 0, targetId: "target_b", evaluatorIds: ["exact"] },
        { ordinal: 2, phase: 1, rowIndex: 2, targetId: "target_a", evaluatorIds: ["exact"] },
        { ordinal: 3, phase: 1, rowIndex: 2, targetId: "target_b", evaluatorIds: ["exact"] },
        { ordinal: 4, phase: 2, rowIndex: 0, targetId: "target_a", evaluatorId: "judge" },
        { ordinal: 5, phase: 2, rowIndex: 1, targetId: "target_a", evaluatorId: "judge" },
        { ordinal: 6, phase: 2, rowIndex: 2, targetId: "target_a", evaluatorId: "judge" },
      ]);
    });

    /** @scenario "A run's plan lists its target cells, then its comparison cells, in one ordinal order" */
    it("keeps every row a cell touches once, at its dataset index", () => {
      const plan = planOf(requestWith());

      expect(plan.rows).toEqual([
        { rowIndex: 0, entry: datasetRows[0] },
        { rowIndex: 1, entry: datasetRows[1] },
        { rowIndex: 2, entry: datasetRows[2] },
      ]);
    });

    /** @scenario "A run's plan lists its target cells, then its comparison cells, in one ordinal order" */
    it("reads mapping buckets from the active dataset, not the first", () => {
      expect(planOf(requestWith()).mappingDatasetId).toBe("dataset_1");
    });

    /** @scenario "A run's plan pins each prompt and workflow at the version the run loaded" */
    it("pins the prompt and workflow versions the run loaded", () => {
      expect(planOf(requestWith()).pinned).toEqual({
        prompts: [{ targetId: "target_a", promptId: "prompt_a", version: 7 }],
        workflows: [{ targetId: "target_b", workflowId: "workflow_b", versionId: "wfv_3" }],
      });
    });

    /** @scenario "A run's plan lists its target cells, then its comparison cells, in one ordinal order" */
    it("carries the run's concurrency, origin, write-back and actor", () => {
      const plan = planOf(requestWith());

      expect(plan).toMatchObject({
        concurrency: 4,
        origin: "workbench",
        persistResults: true,
        actor: { id: "user_1", label: "user" },
        scope: { type: "full" },
      });
      expect(plan.targets.map((target) => target.id)).toEqual(["target_a", "target_b"]);
      expect(plan.evaluators.map((evaluator) => evaluator.id)).toEqual(["exact", "judge"]);
    });
  });

  describe("given the comparison cells a cell reads back from the plan fold", () => {
    /** @scenario "A run's plan lists its target cells, then its comparison cells, in one ordinal order" */
    it("names, for each row, the comparison or the skip the cell's own planner finds", () => {
      const plan = planOf(requestWith({ targets: [promptTarget, workflowTarget, columnJudge()] }));
      const completedTargetOutputs = new Map(
        [0, 2].flatMap((rowIndex): [string, { output: unknown }][] => [
          [`${rowIndex}:target_a`, { output: { output: "a" } }],
          [`${rowIndex}:target_b`, { output: { output: "b" } }],
        ]),
      );

      const found = plan.cells.flatMap((cell) => {
        if (cell.phase !== 2) return [];
        const planned = ExperimentComparisonPlanService.create({}).generateComparisonCells({
          state: comparisonStateOf(plan),
          datasetRows: planDatasetRows(plan),
          completedTargetOutputs,
          scopedRowIndices: [cell.rowIndex],
        });
        const judged = planned.cells.some(
          (candidate) =>
            candidate.targetId === cell.targetId &&
            candidate.evaluatorConfigs[0]?.id === cell.evaluatorId,
        );
        const skipped = planned.skipReasons.find(
          (reason) => reason.targetId === cell.targetId && reason.evaluatorId === cell.evaluatorId,
        );
        return [[cell.rowIndex, cell.evaluatorId, judged ? "judged" : skipped?.kind]];
      });

      expect(found).toEqual([
        [0, "judge", "judged"],
        [1, "judge", "missing-output"],
        [2, "judge", "judged"],
        [0, "column_judge", "judged"],
        [1, "column_judge", "missing-output"],
        [2, "column_judge", "judged"],
      ]);
    });
  });

  describe("given a comparison that cannot be built", () => {
    const setupSkips = [
      { kind: "too-few-variants", config: comparison({ variants: ["target_a"] }) },
      { kind: "golden-not-set", config: comparison({ hasGoldenAnswer: true, goldenField: "" }) },
      { kind: "variant-not-found", config: comparison({ variants: ["target_a", "target_gone"] }) },
    ];

    describe.each(setupSkips)("when its setup is $kind", ({ kind, config }) => {
      /** @scenario "A comparison that cannot be built is planned skipped for every row it covers" */
      it("plans a chip comparison's non-empty rows skipped, anchored on its first live column", () => {
        const plan = planOf(requestWith({ evaluators: [exactMatch, judge(config)] }));

        expect(plan.cells.filter((cell) => cell.phase === 2)).toEqual([
          {
            ordinal: 4,
            phase: 2,
            rowIndex: 0,
            targetId: "target_a",
            evaluatorId: "judge",
            setupSkip: { kind, variantNames: [] },
          },
          {
            ordinal: 5,
            phase: 2,
            rowIndex: 2,
            targetId: "target_a",
            evaluatorId: "judge",
            setupSkip: { kind, variantNames: [] },
          },
        ]);
      });

      /** @scenario "A comparison that cannot be built is planned skipped for every row it covers" */
      it("plans a column comparison's rows skipped under its own column", () => {
        const plan = planOf(
          requestWith({
            targets: [promptTarget, workflowTarget, columnJudge(config)],
            evaluators: [exactMatch],
          }),
        );

        expect(
          plan.cells.flatMap((cell) =>
            cell.phase === 2 ? [[cell.rowIndex, cell.targetId, cell.setupSkip?.kind]] : [],
          ),
        ).toEqual([
          [0, "column_judge", kind],
          [2, "column_judge", kind],
        ]);
      });
    });
  });

  describe("given a run scoped to some rows", () => {
    /** @scenario "A run scoped to some rows plans only those rows" */
    it("plans target and comparison cells for the scoped rows only, in the order asked", () => {
      const plan = planOf(requestWith({ scope: { type: "rows", rowIndices: [2, 0] } }));

      expect(plan.cells.map((cell) => [cell.phase, cell.rowIndex, cell.targetId])).toEqual([
        [1, 2, "target_a"],
        [1, 2, "target_b"],
        [1, 0, "target_a"],
        [1, 0, "target_b"],
        [2, 2, "target_a"],
        [2, 0, "target_a"],
      ]);
      expect(plan.rows.map((row) => row.rowIndex)).toEqual([0, 2]);
    });
  });

  describe("given an evaluator re-run over precomputed outputs", () => {
    /** @scenario "An evaluator re-run plans its precomputed outputs and no comparison" */
    it("plans one judged cell per output, carrying the output and its trace", () => {
      const plan = planOf(
        requestWith({
          scope: {
            type: "evaluator-all-rows",
            targetId: "target_a",
            evaluatorId: "exact",
            precomputedTargetOutputs: { 0: { output: "4" }, 2: { output: "6" } },
            traceIds: { 0: "trace_0", 2: "trace_2" },
          },
        }),
      );

      expect(plan.cells).toEqual([
        {
          ordinal: 0,
          phase: 1,
          rowIndex: 0,
          targetId: "target_a",
          evaluatorIds: ["exact"],
          skipTarget: true,
          precomputedTargetOutput: { output: "4" },
          traceId: "trace_0",
        },
        {
          ordinal: 1,
          phase: 1,
          rowIndex: 2,
          targetId: "target_a",
          evaluatorIds: ["exact"],
          skipTarget: true,
          precomputedTargetOutput: { output: "6" },
          traceId: "trace_2",
        },
      ]);
    });

    /** @scenario "An evaluator re-run plans its precomputed outputs and no comparison" */
    it("plans a single-row re-run without its target when the output is given", () => {
      const plan = planOf(
        requestWith({
          scope: {
            type: "evaluator",
            targetId: "target_b",
            rowIndex: 2,
            evaluatorId: "exact",
            targetOutput: { output: "6" },
          },
        }),
      );

      expect(plan.cells).toEqual([
        {
          ordinal: 0,
          phase: 1,
          rowIndex: 2,
          targetId: "target_b",
          evaluatorIds: ["exact"],
          skipTarget: true,
          precomputedTargetOutput: { output: "6" },
        },
      ]);
      expect(plan.rows).toEqual([{ rowIndex: 2, entry: datasetRows[2] }]);
    });
  });

  describe("given outputs reused from an earlier run", () => {
    /** @scenario "A run scoped to some rows plans only those rows" */
    it("runs no target whose output a scoped comparison reuses, and keeps the seeds", () => {
      const seedTargetOutputs = { "0:target_a": { output: "4", cost: 0.1 } };
      const plan = planOf(
        requestWith({
          scope: { type: "target-rows", targetIds: ["column_judge"], rowIndices: [0] },
          targets: [promptTarget, workflowTarget, columnJudge()],
          evaluators: [],
          seedTargetOutputs,
        }),
      );

      expect(plan.cells.map((cell) => [cell.phase, cell.rowIndex, cell.targetId])).toEqual([
        [1, 0, "target_b"],
        [2, 0, "column_judge"],
      ]);
      expect(plan.seedTargetOutputs).toEqual(seedTargetOutputs);
    });
  });
});
