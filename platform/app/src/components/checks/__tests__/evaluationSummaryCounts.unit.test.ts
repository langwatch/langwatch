/**
 * Verdict counting for the legacy messages list tag and trace list pills
 * (#6835 item 2). A skipped evaluation is not a pass, and a crashed
 * evaluator is not a fail verdict — the counts must keep the three states
 * apart instead of coercing them into pass/fail.
 */
import { describe, expect, it } from "vitest";
import type { ElasticSearchEvaluation } from "~/server/tracer/types";
import { summarizeEvaluationsTag } from "../evaluationSummaryCounts";

function makeEvaluation(
  overrides: Partial<ElasticSearchEvaluation> = {},
): ElasticSearchEvaluation {
  return {
    evaluation_id: "eval-1",
    evaluator_id: "evaluator-1",
    name: "Check",
    status: "processed",
    passed: true,
    score: null,
    label: null,
    ...overrides,
  } as unknown as ElasticSearchEvaluation;
}

describe("summarizeEvaluationsTag", () => {
  describe("given a mixed passed + skipped trace", () => {
    const summary = summarizeEvaluationsTag([
      makeEvaluation({ passed: true }),
      makeEvaluation({
        evaluation_id: "eval-2",
        status: "skipped",
        passed: null,
      }),
    ]);

    it("does not count the skipped run as a pass", () => {
      expect(summary.passes).toBe(1);
    });

    it("keeps the skipped run out of the verdict denominator", () => {
      expect(summary.verdictTotal).toBe(1);
    });

    it("is not reported as all-skipped", () => {
      expect(summary.allSkipped).toBe(false);
    });
  });

  describe("given a processed fail verdict", () => {
    it("counts it as failed", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ passed: false }),
      ]);
      expect(summary.failed).toBe(1);
      expect(summary.passes).toBe(0);
    });
  });

  describe("given a crashed evaluator", () => {
    const summary = summarizeEvaluationsTag([
      makeEvaluation({ status: "error", passed: null }),
      makeEvaluation({ evaluation_id: "eval-2", passed: true }),
    ]);

    it("counts it as errored, never as failed", () => {
      expect(summary.errored).toBe(1);
      expect(summary.failed).toBe(0);
    });

    it("keeps it out of the verdict denominator", () => {
      expect(summary.verdictTotal).toBe(1);
      expect(summary.passes).toBe(1);
    });
  });

  describe("given only skipped evaluations", () => {
    it("reports all-skipped", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ status: "skipped", passed: null }),
      ]);
      expect(summary.allSkipped).toBe(true);
      expect(summary.verdictTotal).toBe(0);
    });
  });

  describe("given an evaluation still running", () => {
    it("is not done", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ status: "in_progress", passed: null }),
      ]);
      expect(summary.done).toBe(false);
    });
  });
});
