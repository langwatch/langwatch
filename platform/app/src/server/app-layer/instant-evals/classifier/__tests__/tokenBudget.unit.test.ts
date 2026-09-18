/**
 * How much text fits beside the questions, and what happens when it does not.
 *
 * @see ../token-budget.ts
 * @see specs/instant-evals/classifier.feature
 */

import { describe, expect, it } from "vitest";

import { estimateTokensFromBytes } from "~/shared/traces/tokenBudget";
import type { InstantEvalQuestion } from "../classifier";
import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  instantEvalQuestionTokens,
  instantEvalTextBudget,
  prepareInstantEvalText,
} from "../token-budget";

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

      expect(instantEvalTextBudget({ questions: enormous })).toBeNull();
    });
  });
});

describe("given a text longer than its budget", () => {
  describe("when it is prepared", () => {
    /** @scenario "A text past its budget is cut rather than refused" */
    it("cuts it to the budget and says that it did", () => {
      const prepared = prepareInstantEvalText({
        text: "sentence. ".repeat(1_000),
        budgetTokens: 100,
      });

      expect(prepared.isTruncated).toBe(true);
      expect(estimateTokensFromBytes(prepared.text)).toBeLessThanOrEqual(100);
    });

    it("leaves a text inside its budget exactly as it was", () => {
      const prepared = prepareInstantEvalText({
        text: "short enough",
        budgetTokens: 100,
      });

      expect(prepared).toEqual({ text: "short enough", isTruncated: false });
    });
  });
});
