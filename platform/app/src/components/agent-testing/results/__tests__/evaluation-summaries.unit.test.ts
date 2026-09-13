/**
 * What the evaluator results of a run add up to.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { describe, expect, it } from "vitest";
import type { ScenarioEvaluationResult } from "~/server/scenarios/schemas/event-schemas";
import {
  evaluationKind,
  failedRequiredEvaluatorName,
  summarizeEvaluations,
} from "../evaluation-summaries";

function evaluation(
  overrides: Partial<ScenarioEvaluationResult> = {},
): ScenarioEvaluationResult {
  return {
    evaluatorId: "eval_sql",
    name: "SQL Query Equivalence",
    status: "passed",
    required: true,
    passed: true,
    ...overrides,
  };
}

const withEvaluations = (evaluations: ScenarioEvaluationResult[]) => ({
  results: { evaluations },
});

describe("summarizeEvaluations", () => {
  describe("given a pass or fail evaluator over three scenarios and one skip", () => {
    /** @scenario "A pass or fail evaluator reads its pass rate over the run" */
    it("reads the pass rate over the verdicts and leaves the skip out", () => {
      const [summary] = summarizeEvaluations({
        runs: [
          withEvaluations([evaluation()]),
          withEvaluations([evaluation()]),
          withEvaluations([evaluation({ status: "failed", passed: false })]),
          withEvaluations([
            evaluation({ status: "skipped", passed: undefined }),
          ]),
        ],
      });

      expect(summary).toMatchObject({
        evaluatorId: "eval_sql",
        name: "SQL Query Equivalence",
        kind: "passfail",
        meanScore: null,
        counted: 3,
        skipped: 1,
      });
      expect(summary?.passRate).toBeCloseTo(66.67, 1);
    });
  });

  describe("given a score evaluator", () => {
    /** @scenario "A score evaluator carries no threshold and no colour" */
    it("reads the mean of its scores and no pass rate", () => {
      const score = (value: number) =>
        evaluation({
          evaluatorId: "eval_latency",
          name: "Reply Latency",
          status: "scored",
          required: false,
          passed: undefined,
          score: value,
        });
      const [summary] = summarizeEvaluations({
        runs: [
          withEvaluations([score(2.6)]),
          withEvaluations([score(3)]),
          withEvaluations([score(2)]),
        ],
      });

      expect(summary).toMatchObject({
        kind: "score",
        passRate: null,
        counted: 3,
        skipped: 0,
      });
      expect(summary?.meanScore).toBeCloseTo(2.533, 3);
    });
  });

  describe("given runs that carry two evaluators", () => {
    it("keeps the evaluators in the order they first appear", () => {
      const summaries = summarizeEvaluations({
        runs: [
          withEvaluations([
            evaluation(),
            evaluation({ evaluatorId: "eval_pii", name: "PII Leak Scanner" }),
          ]),
          withEvaluations([
            evaluation({ evaluatorId: "eval_pii", name: "PII Leak Scanner" }),
            evaluation(),
          ]),
        ],
      });

      expect(summaries.map((summary) => summary.evaluatorId)).toEqual([
        "eval_sql",
        "eval_pii",
      ]);
    });

    it("reads by the name the latest result carries", () => {
      const [summary] = summarizeEvaluations({
        runs: [
          withEvaluations([evaluation({ name: "SQL check" })]),
          withEvaluations([evaluation({ name: "SQL Query Equivalence" })]),
        ],
      });

      expect(summary?.name).toBe("SQL Query Equivalence");
    });
  });

  describe("given runs without evaluations", () => {
    /** @scenario "A run without evaluators shows no evaluator pills" */
    it("reads nothing", () => {
      expect(summarizeEvaluations({ runs: [{ results: null }, {}] })).toEqual(
        [],
      );
    });
  });
});

describe("failedRequiredEvaluatorName", () => {
  describe("given a required evaluator that failed", () => {
    it("names the first one that failed the run", () => {
      expect(
        failedRequiredEvaluatorName([
          evaluation({ status: "failed", passed: false, required: false }),
          evaluation({
            evaluatorId: "eval_pii",
            name: "PII Leak Scanner",
            status: "error",
            passed: undefined,
          }),
          evaluation({ status: "failed", passed: false }),
        ]),
      ).toBe("PII Leak Scanner");
    });
  });

  describe("given only passes, scores, skips and unrequired failures", () => {
    it("names none", () => {
      expect(
        failedRequiredEvaluatorName([
          evaluation(),
          evaluation({ status: "scored", passed: undefined, score: 0.1 }),
          evaluation({ status: "skipped", passed: undefined }),
          evaluation({ status: "failed", passed: false, required: false }),
        ]),
      ).toBeNull();
    });
  });
});

describe("evaluationKind", () => {
  describe("given an evaluation's status and score", () => {
    it("reads a verdict, a number, or nothing", () => {
      expect(evaluationKind(evaluation())).toBe("passfail");
      expect(
        evaluationKind(
          evaluation({ status: "scored", passed: undefined, score: 1 }),
        ),
      ).toBe("score");
      expect(
        evaluationKind(evaluation({ status: "skipped", passed: undefined })),
      ).toBeNull();
      expect(
        evaluationKind(evaluation({ status: "error", passed: undefined })),
      ).toBeNull();
    });
  });
});
