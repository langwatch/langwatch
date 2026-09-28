import {
  COMPARISON_EVALUATOR_TYPE,
  type ComparisonEvaluatorConfig,
  type EvaluatorConfig,
  type TargetConfig,
} from "@langwatch/experiment-contract";
/**
 * Phase 2 from the configuration alone (D5): which comparisons a run has, the rows each covers,
 * and the setup skips known before any target has answered.
 * @see modules/experiment/specs/experiment-run-loop.feature
 */
import { describe, expect, it } from "vitest";

import { ExperimentComparisonPlanService } from "../experiment-comparison-plan.service.ts";

const variant = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
});

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

const chip = (config: ComparisonEvaluatorConfig): EvaluatorConfig => ({
  id: "chip_judge",
  evaluatorType: COMPARISON_EVALUATOR_TYPE,
  inputs: [],
  mappings: {},
  comparison: config,
});

const column = (config: ComparisonEvaluatorConfig): TargetConfig => ({
  id: "column_judge",
  type: "evaluator",
  targetEvaluatorId: "db_judge",
  inputs: [],
  outputs: [{ identifier: "label", type: "str" }],
  mappings: {},
  comparison: config,
});

const datasetRows = [
  { question: "What is 2 + 2?" },
  { question: "" },
  { question: "What is 3 + 3?" },
];

function comparisonSetOf({
  targets,
  evaluators = [],
  scopedRowIndices,
}: {
  targets: TargetConfig[];
  evaluators?: EvaluatorConfig[];
  scopedRowIndices?: number[];
}) {
  return ExperimentComparisonPlanService.create({})
    .buildComparisonSet({ state: { targets, evaluators }, datasetRows, scopedRowIndices })
    .map(({ targetId, evaluatorId, setupSkip, rowIndices }) => ({
      targetId,
      evaluatorId,
      setupSkip,
      rowIndices,
    }));
}

describe("ExperimentComparisonPlanService.buildComparisonSet", () => {
  describe("given a chip and a column comparison over two live variants", () => {
    /** @scenario "The comparison set is planned from the run's configuration alone" */
    it("lists the chip's comparison, then the column's, each over every row in scope", () => {
      const set = comparisonSetOf({
        targets: [variant("target_a"), variant("target_b"), column(comparison())],
        evaluators: [chip(comparison({ variants: ["target_b", "target_a"] }))],
      });

      expect(set).toEqual([
        {
          targetId: "target_b",
          evaluatorId: "chip_judge",
          setupSkip: undefined,
          rowIndices: [0, 1, 2],
        },
        {
          targetId: "column_judge",
          evaluatorId: "column_judge",
          setupSkip: undefined,
          rowIndices: [0, 1, 2],
        },
      ]);
    });

    /** @scenario "The comparison set is planned from the run's configuration alone" */
    it("covers only the scoped rows the dataset has", () => {
      const set = comparisonSetOf({
        targets: [variant("target_a"), variant("target_b"), column(comparison())],
        scopedRowIndices: [2, 7],
      });

      expect(set.map((planned) => planned.rowIndices)).toEqual([[2]]);
    });
  });

  describe("given a comparison whose setup is incomplete", () => {
    /** @scenario "A comparison that cannot be built is planned skipped for every row it covers" */
    it.each([
      ["too-few-variants", comparison({ variants: ["target_a"] })],
      ["golden-not-set", comparison({ hasGoldenAnswer: true, goldenField: "" })],
      ["variant-not-found", comparison({ variants: ["target_gone", "target_a"] })],
    ])("reports %s over the non-empty rows, anchored on the first live column", (kind, config) => {
      const set = comparisonSetOf({
        targets: [variant("target_a"), variant("target_b")],
        evaluators: [chip(config)],
      });

      expect(set).toEqual([
        { targetId: "target_a", evaluatorId: "chip_judge", setupSkip: kind, rowIndices: [0, 2] },
      ]);
    });

    /** @scenario "A comparison that cannot be built is planned skipped for every row it covers" */
    it("plans nothing for a chip comparison none of whose columns exist", () => {
      const set = comparisonSetOf({
        targets: [variant("target_a")],
        evaluators: [chip(comparison({ variants: ["target_gone"] }))],
      });

      expect(set).toEqual([]);
    });
  });
});
