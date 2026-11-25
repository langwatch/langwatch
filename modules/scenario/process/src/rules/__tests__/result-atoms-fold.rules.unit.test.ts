/**
 * The atoms the read folds are the atoms the Results tab's output schema accepts. TypeScript
 * accepts a value with more fields than the schema's type, so a field the fold adds and the
 * strict schema does not name typechecks and still fails at run time (2026-10-27).
 */

import { resultAtomsPageSchema, ScenarioRunStatus } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import type { RawAtomRow } from "../../repositories/result-atoms.repository.ts";
import { toAtom } from "../result-atoms-fold.rules.ts";

function rawRow(overrides: Partial<RawAtomRow> = {}): RawAtomRow {
  return {
    SetId: "set-1",
    BatchRunId: "batch-1",
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    ScenarioKey: "scenario-1",
    ScenarioName: "Refund request",
    Status: ScenarioRunStatus.SUCCESS,
    Outcome: "passed",
    RunAt: "1761523200000",
    DurationMs: "1200",
    Note: "",
    TargetKey: "agent-1",
    TargetParameters: "",
    TargetName: "",
    Trigger: "app",
    CostUsd: "0.01",
    CostSource: "run",
    SortKey: "1",
    EvaluationIds: [],
    EvaluationNames: [],
    EvaluationStatuses: [],
    EvaluationRequired: [],
    EvaluationPassed: [],
    EvaluationScores: [],
    EvaluationLabels: [],
    ...overrides,
  };
}

function fold(row: RawAtomRow) {
  return toAtom({ row, ordinalByRun: new Map(), plans: new Map() });
}

describe("toAtom", () => {
  describe("when the run carries evaluator results", () => {
    /** @scenario "An atom with its evaluator results is one the Results tab accepts" */
    it("folds an atom the page schema accepts", () => {
      const atom = fold(
        rawRow({
          EvaluationIds: ["evaluator-1", "evaluator-2"],
          EvaluationNames: ["Tone", "Accuracy"],
          EvaluationStatuses: ["passed", "scored"],
          EvaluationRequired: [1, 0],
          EvaluationPassed: [1, null],
          EvaluationScores: [null, 0.8],
          EvaluationLabels: ["", "good"],
        }),
      );

      const parsed = resultAtomsPageSchema.safeParse({ atoms: [atom], hasMore: false });

      expect(parsed.error?.issues).toBeUndefined();
      expect(parsed.data?.atoms[0]?.evaluations).toEqual([
        {
          evaluatorId: "evaluator-1",
          name: "Tone",
          status: "passed",
          required: true,
          passed: true,
          score: null,
          label: null,
        },
        {
          evaluatorId: "evaluator-2",
          name: "Accuracy",
          status: "scored",
          required: false,
          passed: null,
          score: 0.8,
          label: "good",
        },
      ]);
    });
  });

  describe("when the run carries no evaluator results", () => {
    /** @scenario "An atom with its evaluator results is one the Results tab accepts" */
    it("folds an atom the page schema accepts", () => {
      const parsed = resultAtomsPageSchema.safeParse({
        atoms: [fold(rawRow())],
        hasMore: false,
      });

      expect(parsed.error?.issues).toBeUndefined();
    });
  });
});
