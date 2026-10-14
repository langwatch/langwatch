/**
 * How much text fits beside the questions, and what one request is expected to cost.
 * @see modules/instant-eval/specs/classifier.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalQuestion,
} from "../instant-eval-judge.api.ts";
import {
  estimateInstantEvalRequestTokens,
  estimateJudgedTextTokens,
  estimateTokensFromBytes,
  instantEvalQuestionTokens,
  instantEvalTextBudget,
} from "../instant-eval-token-budget.ts";

const question = (id: string, instructions: string): InstantEvalQuestion => ({
  id,
  kind: "boolean",
  instructions,
});

describe("given a handful of questions about one text", () => {
  const questions = [
    question("a", "The customer sounds annoyed"),
    question("b", "The agent apologised"),
    question("c", "The problem was solved"),
  ];

  describe("when the text budget is computed", () => {
    /** @scenario "The text budget is what is left of the state cap after the questions" */
    it("is the state cap less the questions and less the reserve", () => {
      expect(instantEvalTextBudget({ questions })).toBe(
        INSTANT_EVAL_CLASSIFIER_LIMITS.stateTokens -
          instantEvalQuestionTokens(questions) -
          INSTANT_EVAL_CLASSIFIER_LIMITS.reserveTokens,
      );
    });
  });

  describe("when the questions alone fill the state cap", () => {
    /** @scenario "A question list that leaves no room for text is refused before it is sent" */
    it("answers that there is no room rather than sending an empty text", () => {
      const enormous = [question("a", "x".repeat(200_000))];

      expect(instantEvalTextBudget({ questions: enormous })).toBe(0);
    });
  });
});

describe("given a piece of judged text", () => {
  describe("when its input tokens are estimated", () => {
    /** @scenario "Judged text is priced at the classifier's own published byte ratio" */
    it("counts it at the ratio the classifier publishes", () => {
      const text = "x".repeat(2_700);

      expect(estimateJudgedTextTokens({ text })).toBe(
        Math.ceil(2_700 / INSTANT_EVAL_CLASSIFIER_LIMITS.bytesPerInputToken),
      );
    });

    it("counts more tokens than the four-bytes-per-token prose rule", () => {
      const text = "x".repeat(4_000);

      expect(estimateJudgedTextTokens({ text })).toBeGreaterThan(estimateTokensFromBytes(text));
    });

    it("honours a classifier that publishes a different ratio", () => {
      const text = "x".repeat(1_000);

      expect(
        estimateJudgedTextTokens({
          text,
          limits: { ...INSTANT_EVAL_CLASSIFIER_LIMITS, bytesPerInputToken: 4 },
        }),
      ).toBe(250);
    });

    it("prices a whole request as the text plus its questions", () => {
      const text = "x".repeat(2_700);
      const questions = [question("q1", "the customer sounds annoyed")];

      expect(estimateInstantEvalRequestTokens({ text, questions })).toBe(
        estimateJudgedTextTokens({ text }) + instantEvalQuestionTokens(questions),
      );
    });
  });
});
