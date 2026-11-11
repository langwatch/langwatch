/** @see modules/experiment/specs/experiment-run-summary-verdicts.feature */
import { describe, expect, it } from "vitest";

import { summariseEvaluatorVerdicts } from "../experiment-run-summary.rules.ts";

const scoring = (fallbackName: string) => ({
  recordNamed: false,
  fallbackName,
  comparison: false,
});

describe("summariseEvaluatorVerdicts", () => {
  describe("given an evaluator that passed on two cells and failed on one", () => {
    /** @scenario "A completed run tallies each evaluator's verdicts" */
    it("tallies the verdicts per evaluator", () => {
      const summary = summariseEvaluatorVerdicts({
        evaluators: { ev_1: scoring("exact_match") },
        evaluatorScores: {
          "0:target_1": { ev_1: { name: "exact_match", score: 1, passed: true } },
          "1:target_1": { ev_1: { name: "exact_match", score: 1, passed: true } },
          "2:target_1": { ev_1: { name: "exact_match", score: 0, passed: false } },
        },
      });

      expect(summary?.evaluators).toEqual([
        {
          evaluatorId: "ev_1",
          name: "exact_match",
          passed: 2,
          failed: 1,
          errored: 0,
          passRate: (2 / 3) * 100,
          avgScore: 2 / 3,
        },
      ]);
    });
  });

  describe("given an evaluator that crashed on some cells", () => {
    /** @scenario "An evaluator that crashes counts as errored, not passed" */
    it("counts the crashes as errored and keeps the verdict it did give", () => {
      const summary = summariseEvaluatorVerdicts({
        evaluators: { ev_1: scoring("faithfulness") },
        evaluatorScores: {
          "0:target_1": { ev_1: { name: "faithfulness", errored: true } },
          "1:target_1": { ev_1: { name: "faithfulness", errored: true } },
          "2:target_1": { ev_1: { name: "faithfulness", passed: true } },
        },
      });

      expect(summary?.evaluators[0]).toMatchObject({ passed: 1, failed: 0, errored: 2 });
    });
  });

  describe("given an evaluator that crashed on every cell", () => {
    /** @scenario "An evaluator that crashes on every cell is not reported as passing" */
    it("reports no passes and every cell errored", () => {
      const summary = summariseEvaluatorVerdicts({
        evaluators: { ev_1: scoring("faithfulness") },
        evaluatorScores: {
          "0:target_1": { ev_1: { name: "faithfulness", errored: true } },
          "1:target_1": { ev_1: { name: "faithfulness", errored: true } },
        },
      });

      expect(summary?.evaluators[0]).toMatchObject({ passed: 0, failed: 0, errored: 2 });
    });
  });

  describe("given an evaluator that scored without a verdict", () => {
    /** @scenario "A score without a verdict counts towards the average only" */
    it("averages the scores and counts no verdict", () => {
      const summary = summariseEvaluatorVerdicts({
        evaluators: { ev_1: scoring("faithfulness") },
        evaluatorScores: {
          "0:target_1": { ev_1: { name: "faithfulness", score: 0.4 } },
          "1:target_1": { ev_1: { name: "faithfulness", score: 0.8 } },
        },
      });

      expect(summary?.evaluators[0]).toMatchObject({ passed: 0, failed: 0 });
      expect(summary?.evaluators[0]?.avgScore).toBeCloseTo(0.6);
    });
  });

  describe("given verdicts that a released SDK would read as its exit gate", () => {
    /** @scenario "Run-wide totals stay unset so released SDKs keep their exit codes" */
    it("leaves totalPassed, totalFailed and passRate out of the summary", () => {
      const summary = summariseEvaluatorVerdicts({
        evaluators: { ev_1: scoring("exact_match") },
        evaluatorScores: {
          "0:target_1": { ev_1: { name: "exact_match", passed: false } },
        },
      });

      expect(summary?.evaluators[0]).toMatchObject({ failed: 1 });
      expect(summary).not.toHaveProperty("totalPassed");
      expect(summary).not.toHaveProperty("totalFailed");
      expect(summary).not.toHaveProperty("passRate");
    });
  });

  describe("given a comparison evaluator next to a scoring one", () => {
    /** @scenario "A comparison evaluator keeps no verdicts and is left out" */
    it("lists only the scoring evaluator", () => {
      const summary = summariseEvaluatorVerdicts({
        evaluators: {
          ev_1: scoring("exact_match"),
          ev_cmp: { recordNamed: false, fallbackName: "pairwise", comparison: true },
        },
        evaluatorScores: {
          "0:target_1": { ev_1: { name: "exact_match", passed: true } },
        },
      });

      expect(summary?.evaluators.map((tally) => tally.evaluatorId)).toEqual(["ev_1"]);
    });
  });

  describe("given a run with no evaluators", () => {
    /** @scenario "A run with no evaluators adds no verdict fields" */
    it("answers nothing, so the summary keeps its cell counts only", () => {
      expect(summariseEvaluatorVerdicts({ evaluators: {}, evaluatorScores: {} })).toBeUndefined();
    });
  });
});
