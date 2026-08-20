/**
 * Verdict counting for the legacy messages list tag and trace list pills
 * (#6835 item 2). A skipped evaluation is not a pass, and a crashed
 * evaluator is not a fail verdict — the counts must keep the three states
 * apart instead of coercing them into pass/fail.
 */
import { describe, expect, it } from "vitest";
import type { ElasticSearchEvaluation } from "~/server/tracer/types";
import {
  evaluationsTagLabel,
  guardrailsTagLabel,
  summarizeEvaluationsTag,
} from "../evaluationSummaryCounts";

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
  describe("when the trace mixes passed and skipped runs", () => {
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

    it("still reports every run in total and counts the skipped one", () => {
      expect(summary.total).toBe(2);
      expect(summary.skipped).toBe(1);
    });

    it("is not reported as all-skipped", () => {
      expect(summary.hasOnlySkippedRuns).toBe(false);
    });
  });

  describe("when a processed run carries a fail verdict", () => {
    it("counts it as failed", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ passed: false }),
      ]);
      expect(summary.failed).toBe(1);
      expect(summary.passes).toBe(0);
    });
  });

  describe("when an evaluator crashed", () => {
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

  describe("when every evaluation was skipped", () => {
    it("reports all-skipped", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ status: "skipped", passed: null }),
      ]);
      expect(summary.hasOnlySkippedRuns).toBe(true);
      expect(summary.verdictTotal).toBe(0);
    });
  });

  describe("when an evaluation is still running", () => {
    it("is not done", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ status: "in_progress", passed: null }),
      ]);
      expect(summary.done).toBe(false);
    });
  });
});

describe("evaluationsTagLabel", () => {
  describe("when the trace mixes fails, errors, and skips", () => {
    it("keeps every terminal count visible — no state hides another", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ passed: false }),
        makeEvaluation({ evaluation_id: "e2", status: "error", passed: null }),
        makeEvaluation({
          evaluation_id: "e3",
          status: "skipped",
          passed: null,
        }),
      ]);
      expect(evaluationsTagLabel(summary)).toBe(
        "1 evaluation failed, 1 errored, 1 skipped",
      );
    });
  });

  describe("when errored and skipped runs finish without fails", () => {
    it("names both", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ status: "error", passed: null }),
        makeEvaluation({
          evaluation_id: "e2",
          status: "skipped",
          passed: null,
        }),
      ]);
      expect(evaluationsTagLabel(summary)).toBe(
        "1 evaluation errored, 1 skipped",
      );
    });
  });

  describe("when runs are still in flight", () => {
    it("counts passes out of every evaluation on the trace", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ passed: true }),
        makeEvaluation({
          evaluation_id: "e2",
          status: "in_progress",
          passed: null,
        }),
        makeEvaluation({
          evaluation_id: "e3",
          status: "in_progress",
          passed: null,
        }),
      ]);
      expect(evaluationsTagLabel(summary)).toBe("1/3 evaluations");
    });
  });

  describe("when everything passed with some skipped", () => {
    it("reconciles with the popover list", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ passed: true }),
        makeEvaluation({
          evaluation_id: "e2",
          status: "skipped",
          passed: null,
        }),
      ]);
      expect(evaluationsTagLabel(summary)).toBe("1/1 evaluations, 1 skipped");
    });
  });
});

describe("guardrailsTagLabel", () => {
  describe("when a guardrail blocked while another errored", () => {
    it("shows the block and the error side by side", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ passed: false }),
        makeEvaluation({ evaluation_id: "g2", status: "error", passed: null }),
      ]);
      expect(guardrailsTagLabel(summary)).toBe("1 guardrail block, 1 errored");
    });
  });

  describe("when guardrails are still running", () => {
    it("does not render a green zero-of-zero", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ status: "in_progress", passed: null }),
      ]);
      expect(guardrailsTagLabel(summary)).toBe("0/1 guardrails");
    });
  });

  describe("when a skipped guardrail rides beside a pass", () => {
    it("is not counted as a pass, only named", () => {
      const summary = summarizeEvaluationsTag([
        makeEvaluation({ passed: true }),
        makeEvaluation({
          evaluation_id: "g2",
          status: "skipped",
          passed: null,
        }),
      ]);
      expect(guardrailsTagLabel(summary)).toBe("1/1 guardrails, 1 skipped");
    });
  });
});
