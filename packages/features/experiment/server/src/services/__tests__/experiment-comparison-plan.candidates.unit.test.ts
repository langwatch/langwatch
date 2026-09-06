/**
 * Phase 2: what a comparison judges, what it waits for, and what it refuses to
 * judge — for both the chip-style evaluator and the column-style target.
 * @see specs/experiments-v3/comparison-error-handling.feature
 */
import { describe, expect, it } from "vitest";
import {
  COMPARISON_EVALUATOR_TYPE,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
  type EvaluationsV3State,
  type EvaluatorConfig,
  type ExecutionCell,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import {
  ExperimentComparisonPlanService,
  type VariantEvaluatorScore,
} from "../experiment-comparison-plan.service.ts";
import type { LoadedEvaluators } from "../experiment-execution-data.service.ts";
import type { VersionedPrompt } from "@langwatch/prompt-contract";

type PlanState = Pick<
  EvaluationsV3State,
  "datasets" | "activeDatasetId" | "targets" | "evaluators"
>;

type SeededOutput = { output: unknown; cost?: number; duration?: number };

const comparisonConfig = (overrides: Record<string, unknown> = {}) => ({
  variants: ["target-1", "target-2"],
  hasGoldenAnswer: true,
  goldenField: "expected",
  includeMetrics: [],
  randomizeOrder: false,
  ...overrides,
});

const variantTargets = (count = 2) =>
  Array.from({ length: count }, (_, i) => ({
    id: `target-${i + 1}`,
    type: "prompt" as const,
    name: `Target ${i + 1}`,
    promptId: `prompt-${i + 1}`,
    inputs: [{ identifier: "input", type: "str" as const }],
    outputs: [{ identifier: "output", type: "str" as const }],
    mappings: {},
  })) as PlanState["targets"];

/** Two prompts with distinct handles, so a variant reads as its handle rather than "New Prompt". */
const loadedPrompts = new Map([
  ["prompt-1@latest", { handle: "say-hi" } as VersionedPrompt],
  ["prompt-2@latest", { handle: "say-hello" } as VersionedPrompt],
]);

const stateWithChipComparison = (
  comparison: Record<string, unknown> = comparisonConfig(),
): PlanState => ({
  datasets: [{ id: "dataset-1", name: "Test Dataset" } as PlanState["datasets"][0]],
  activeDatasetId: "dataset-1",
  targets: variantTargets(),
  evaluators: [
    {
      id: "comparison-eval",
      name: "Judge",
      evaluatorType: COMPARISON_EVALUATOR_TYPE,
      inputs: [{ identifier: "candidates", type: "str" }],
      mappings: {},
      comparison,
    } as unknown as EvaluatorConfig,
  ],
});

const stateWithColumnComparison = (
  comparison: Record<string, unknown> = comparisonConfig(),
): PlanState => ({
  datasets: [{ id: "dataset-1", name: "Test Dataset" } as PlanState["datasets"][0]],
  activeDatasetId: "dataset-1",
  targets: [
    ...variantTargets(),
    {
      id: "comparison-target",
      type: "evaluator",
      name: "Which is better",
      targetEvaluatorId: "db-judge",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "label", type: "str" }],
      mappings: {},
      comparison,
    } as unknown as TargetConfig,
  ] as PlanState["targets"],
  evaluators: [],
});

const rows = (count = 2) =>
  Array.from({ length: count }, (_, i) => ({
    question: `Question ${i}`,
    expected: `Answer ${i}`,
    input: `Task ${i}`,
  }));

const outputsFor = (entries: Array<[string, unknown]>) =>
  new Map<string, SeededOutput>(entries.map(([key, output]) => [key, { output }]));

const planWith = ({
  state,
  datasetRows = rows(),
  completedTargetOutputs,
  completedTargetEvaluatorScores,
  scopedRowIndices,
  loadedEvaluators,
  prompts = loadedPrompts,
}: {
  state: PlanState;
  datasetRows?: Array<Record<string, unknown>>;
  completedTargetOutputs: Map<string, SeededOutput>;
  completedTargetEvaluatorScores?: Map<string, VariantEvaluatorScore[]>;
  scopedRowIndices?: number[];
  loadedEvaluators?: LoadedEvaluators;
  prompts?: Map<string, VersionedPrompt>;
}) =>
  ExperimentComparisonPlanService.create({
    loadedEvaluators,
    loadedPrompts: prompts,
  }).generateComparisonCells({
    state,
    datasetRows,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
    scopedRowIndices,
  });

const candidateTexts = (cell: ExecutionCell) =>
  cell.comparison?.candidates.map((candidate) => candidate.output);

describe("given a comparison whose columns have not all answered", () => {
  describe("when phase two plans its cells", () => {
    /** @scenario "A comparison waits for every column it compares" */
    it("judges nothing and names the column it is waiting on", () => {
      const { cells, skipReasons } = planWith({
        state: stateWithChipComparison(),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([["0:target-1", "answer one"]]),
      });

      expect(cells).toHaveLength(0);
      expect(skipReasons).toEqual([
        {
          rowIndex: 0,
          targetId: "target-1",
          evaluatorId: "comparison-eval",
          kind: "missing-output",
          variantNames: ["say-hello"],
        },
      ]);
    });

    /** @scenario "A comparison waits for every column it compares" */
    it("judges the row once every column has answered", () => {
      const { cells, skipReasons } = planWith({
        state: stateWithChipComparison(),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([
          ["0:target-1", "answer one"],
          ["0:target-2", "answer two"],
        ]),
      });

      expect(skipReasons).toHaveLength(0);
      expect(cells).toHaveLength(1);
      expect(candidateTexts(cells[0]!)).toEqual(["answer one", "answer two"]);
    });
  });

  describe("when the run is scoped to one row", () => {
    /** @scenario "A comparison reports only the rows the run was scoped to" */
    it("reports that row and stays silent about the rest", () => {
      const { skipReasons } = planWith({
        state: stateWithChipComparison(),
        datasetRows: rows(3),
        completedTargetOutputs: outputsFor([["1:target-1", "answer one"]]),
        scopedRowIndices: [1],
      });

      expect(skipReasons.map((reason) => reason.rowIndex)).toEqual([1]);
      expect(skipReasons[0]?.variantNames).toEqual(["say-hello"]);
    });
  });
});

describe("given two columns running the same prompt", () => {
  const sameHandle = new Map([
    ["prompt-1@latest", { handle: "say-hi" } as VersionedPrompt],
    ["prompt-2@latest", { handle: "say-hi" } as VersionedPrompt],
  ]);

  describe("when phase two names the candidates", () => {
    /** @scenario "Two columns running one prompt are still told apart" */
    it("identifies each candidate by its own column so the verdict lands on one of them", () => {
      const { cells } = planWith({
        state: stateWithChipComparison(),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([
          ["0:target-1", "answer one"],
          ["0:target-2", "answer two"],
        ]),
        prompts: sameHandle,
      });

      expect(cells[0]?.comparison?.candidates.map((candidate) => candidate.id)).toEqual([
        "target-1",
        "target-2",
      ]);
    });

    /** @scenario "Two columns running one prompt are still told apart" */
    it("tells the customer which one it waits on with a numbered name, not a raw id", () => {
      const { skipReasons } = planWith({
        state: stateWithChipComparison(),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([["0:target-1", "answer one"]]),
        prompts: sameHandle,
      });

      expect(skipReasons[0]?.variantNames).toEqual(["say-hi (2)"]);
    });
  });
});

describe("given a column whose answer has no text to judge", () => {
  describe("when phase two plans its cells", () => {
    /** @scenario "A comparison refuses to judge a column with nothing to compare" */
    it.each([
      { name: "the column answered with nothing", output: "" },
      { name: "the column answered null", output: null },
    ])("skips the row and names the column when $name", ({ output }) => {
      const { cells, skipReasons } = planWith({
        state: stateWithChipComparison(),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([
          ["0:target-1", "answer one"],
          ["0:target-2", output],
        ]),
      });

      expect(cells).toHaveLength(0);
      expect(skipReasons[0]).toMatchObject({
        kind: "empty-output",
        variantNames: ["say-hello"],
      });
    });

    /** @scenario "A comparison refuses to judge a column with nothing to compare" */
    it("skips the row when the picked output field is gone", () => {
      const { cells, skipReasons } = planWith({
        state: stateWithChipComparison(
          comparisonConfig({ variantOutputPaths: { "target-2": ["summary"] } }),
        ),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([
          ["0:target-1", "answer one"],
          ["0:target-2", { other: "still here" }],
        ]),
      });

      expect(cells).toHaveLength(0);
      expect(skipReasons[0]).toMatchObject({
        kind: "empty-output",
        variantNames: ["say-hello"],
      });
    });

    /** @scenario "A comparison refuses to judge a column with nothing to compare" */
    it("judges the picked field's own value when the field is there", () => {
      const { cells } = planWith({
        state: stateWithChipComparison(
          comparisonConfig({ variantOutputPaths: { "target-2": ["summary"] } }),
        ),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([
          ["0:target-1", "answer one"],
          ["0:target-2", { summary: "the short version", other: "ignored" }],
        ]),
      });

      expect(candidateTexts(cells[0]!)).toEqual(["answer one", "the short version"]);
    });
  });
});

describe("given the columns already carry their own evaluator scores", () => {
  describe("when phase two builds the candidates", () => {
    const scores = new Map<string, VariantEvaluatorScore[]>([
      ["0:target-1", [{ name: "Exact Match", score: 1, passed: true }]],
    ]);

    /** @scenario "A comparison shows the judge the scores a column already earned" */
    it("appends a column's own scores to that column's candidate only", () => {
      const { cells } = planWith({
        state: stateWithChipComparison(),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([
          ["0:target-1", "answer one"],
          ["0:target-2", "answer two"],
        ]),
        completedTargetEvaluatorScores: scores,
      });

      const [first, second] = candidateTexts(cells[0]!) ?? [];
      expect(first).toContain("answer one");
      expect(first).toContain("Exact Match: score=1, passed=true");
      expect(second).toBe("answer two");
    });

    /** @scenario "A comparison shows the judge the scores a column already earned" */
    it("appends them to the picked field rather than the whole answer", () => {
      const { cells } = planWith({
        state: stateWithChipComparison(
          comparisonConfig({ variantOutputPaths: { "target-1": ["summary"] } }),
        ),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([
          ["0:target-1", { summary: "the short version", other: "ignored" }],
          ["0:target-2", "answer two"],
        ]),
        completedTargetEvaluatorScores: scores,
      });

      const [first] = candidateTexts(cells[0]!) ?? [];
      expect(first).toContain("the short version");
      expect(first).not.toContain("ignored");
      expect(first).toContain("Exact Match: score=1, passed=true");
    });

    /** @scenario "A comparison refuses to judge a column with nothing to compare" */
    it("skips a row rather than sending the judge scores with no answer under them", () => {
      const { cells, skipReasons } = planWith({
        state: stateWithChipComparison(),
        datasetRows: rows(1),
        completedTargetOutputs: outputsFor([
          ["0:target-1", ""],
          ["0:target-2", "answer two"],
        ]),
        completedTargetEvaluatorScores: scores,
      });

      expect(cells).toHaveLength(0);
      expect(skipReasons[0]).toMatchObject({ kind: "empty-output", variantNames: ["say-hi"] });
    });
  });
});

describe("given a comparison that is its own column", () => {
  const twoAnswers = () =>
    outputsFor([
      ["0:target-1", "answer one"],
      ["0:target-2", "answer two"],
    ]);

  const dispatchedFields = (cell: { evaluatorConfigs: EvaluatorConfig[] }) =>
    Object.keys(cell.evaluatorConfigs[0]!.mappings["dataset-1"]?.["comparison-target"] ?? {});

  describe("when the judge behind it is the N-way one", () => {
    /** @scenario "A comparison column dispatches the shape its judge expects" */
    it("dispatches the whole candidate list", () => {
      const { cells } = planWith({
        state: stateWithColumnComparison(),
        datasetRows: rows(1),
        completedTargetOutputs: twoAnswers(),
      });

      expect(cells[0]?.evaluatorConfigs[0]?.evaluatorType).toBe(COMPARISON_EVALUATOR_TYPE);
      expect(dispatchedFields(cells[0]!)).toEqual(["candidates", "row_index", "input", "golden"]);
    });
  });

  describe("when the judge behind it is still the legacy two-column one", () => {
    const legacyEvaluators: LoadedEvaluators = new Map([
      [
        "db-judge",
        {
          id: "db-judge",
          name: "Pairwise",
          config: { evaluatorType: LEGACY_PAIRWISE_EVALUATOR_TYPE },
        },
      ],
    ]);

    /** @scenario "A comparison column dispatches the shape its judge expects" */
    it("dispatches the two slots that judge reads instead", () => {
      const { cells } = planWith({
        state: stateWithColumnComparison(),
        datasetRows: rows(1),
        completedTargetOutputs: twoAnswers(),
        loadedEvaluators: legacyEvaluators,
      });

      expect(cells[0]?.evaluatorConfigs[0]?.evaluatorType).toBe(LEGACY_PAIRWISE_EVALUATOR_TYPE);
      expect(dispatchedFields(cells[0]!)).toEqual([
        "candidate_a_id",
        "candidate_a_output",
        "candidate_a_cost",
        "candidate_a_duration",
        "candidate_b_id",
        "candidate_b_output",
        "candidate_b_cost",
        "candidate_b_duration",
        "input",
        "golden",
      ]);
    });
  });

  describe("when it does not judge against a golden answer", () => {
    /** @scenario "A comparison that judges no golden answer sends none" */
    it("sends no golden answer even though a stale field is still picked", () => {
      const { cells } = planWith({
        state: stateWithColumnComparison(
          comparisonConfig({ hasGoldenAnswer: false, goldenField: "expected" }),
        ),
        datasetRows: rows(1),
        completedTargetOutputs: twoAnswers(),
      });

      const mappings = cells[0]!.evaluatorConfigs[0]!.mappings["dataset-1"]?.["comparison-target"];
      expect(mappings?.golden).toEqual({ type: "value", value: undefined });
    });
  });
});
