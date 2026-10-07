import {
  instantEvalSkipped,
  type InstantEvalJudgement,
  type InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import type { InstantEvalJudge } from "../instant-eval-judge-question.rules.ts";
import { instantEvalJudgeResult } from "../instant-eval-judge-result.rules.ts";

const booleanJudge: InstantEvalJudge = {
  evaluatorType: "langevals/llm_boolean",
  settings: { prompt: "return false if it mentions a competitor" },
};

function answered(verdict: Omit<InstantEvalVerdict, "questionId">): InstantEvalJudgement {
  return {
    verdicts: [{ questionId: "judge", ...verdict }],
    inputTokens: 500,
    isTextTruncated: false,
  };
}

describe("instantEvalJudgeResult", () => {
  describe("given a boolean judge", () => {
    /** @scenario "A boolean judge passes when true is the likely answer" */
    it("passes with score 1 and a confidence line when true is likely", () => {
      expect(
        instantEvalJudgeResult({
          judge: booleanJudge,
          judgement: answered({ probability: 0.82 }),
          priceUsd: 0.0001,
        }),
      ).toEqual({
        status: "processed",
        passed: true,
        score: 1,
        details: "Instant Evals: true, 82% confident",
        cost: { currency: "USD", amount: 0.0001 },
      });
    });

    /** @scenario "A fail-condition prompt keeps its polarity" */
    it("does not pass with score 0 when false is likely", () => {
      expect(
        instantEvalJudgeResult({
          judge: booleanJudge,
          judgement: answered({ probability: 0.2 }),
          priceUsd: 0.0001,
        }),
      ).toMatchObject({
        status: "processed",
        passed: false,
        score: 0,
        details: "Instant Evals: false, 80% confident",
      });
    });
  });

  describe("given a score judge", () => {
    it("returns the answer on the judge's own range", () => {
      expect(
        instantEvalJudgeResult({
          judge: {
            evaluatorType: "langevals/llm_score",
            settings: { prompt: "rate", min: 0, max: 10 },
          },
          judgement: answered({ score: 8 }),
          priceUsd: 0,
        }),
      ).toMatchObject({ status: "processed", score: 8, details: "Instant Evals: 8" });
    });
  });

  describe("given a category judge", () => {
    /** @scenario "A category judge returns the most likely category" */
    it("labels the most likely category and leaves passed unset", () => {
      const result = instantEvalJudgeResult({
        judge: {
          evaluatorType: "langevals/llm_category",
          settings: {
            prompt: "sort",
            categories: [
              { name: "refund", description: "money back" },
              { name: "complaint", description: "unhappy" },
            ],
          },
        },
        judgement: answered({ label: "refund", probabilities: { refund: 0.64, complaint: 0.36 } }),
        priceUsd: 0,
      });
      expect(result).toMatchObject({
        status: "processed",
        label: "refund",
        details: "Instant Evals: refund, 64% confident",
      });
      expect(result).not.toHaveProperty("passed");
    });
  });

  describe("given a judge call answered with a price", () => {
    /** @scenario "The result's cost is the customer price" */
    it("carries that price in USD", () => {
      expect(
        instantEvalJudgeResult({
          judge: booleanJudge,
          judgement: answered({ probability: 0.9 }),
          priceUsd: 0.0042,
        }),
      ).toMatchObject({ cost: { currency: "USD", amount: 0.0042 } });
    });
  });

  describe("given the classifier skipped", () => {
    /** @scenario "A classifier skip maps to a result status" */
    it.each([
      { reason: "classifier_input_too_large", status: "skipped" },
      { reason: "classifier_not_configured", status: "error" },
      { reason: "classifier_rate_limited", status: "error" },
      { reason: "classifier_failed", status: "error" },
    ] as const)("maps $reason to $status", ({ reason, status }) => {
      const result = instantEvalJudgeResult({
        judge: booleanJudge,
        judgement: instantEvalSkipped(reason),
        priceUsd: 0,
      });
      expect(result.status).toBe(status);
      expect(result.details).toContain(reason);
    });

    it.each(["classifier_not_configured", "classifier_rate_limited", "classifier_failed"] as const)(
      "carries %s as the error type, so alerts can tell outages apart",
      (reason) => {
        expect(
          instantEvalJudgeResult({
            judge: booleanJudge,
            judgement: instantEvalSkipped(reason),
            priceUsd: 0,
          }),
        ).toMatchObject({ status: "error", error_type: reason, traceback: [] });
      },
    );
  });

  describe("given a boolean verdict with no probability", () => {
    it("is an error, never a confident false", () => {
      expect(
        instantEvalJudgeResult({
          judge: booleanJudge,
          judgement: answered({}),
          priceUsd: 0,
        }),
      ).toMatchObject({ status: "error", error_type: "classifier_failed" });
    });
  });

  describe("given an answer that holds no verdict for the question", () => {
    it("is an error, never a pass", () => {
      expect(
        instantEvalJudgeResult({
          judge: booleanJudge,
          judgement: { verdicts: [], inputTokens: 10, isTextTruncated: false },
          priceUsd: 0,
        }),
      ).toMatchObject({ status: "error", error_type: "classifier_failed" });
    });
  });
});
