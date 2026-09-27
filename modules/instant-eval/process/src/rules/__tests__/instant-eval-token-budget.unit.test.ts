/**
 * How much text fits beside the questions, and what happens when it does not.
 * @see specs/instant-evals/classifier.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  cutInstantEvalTextForRetry,
  estimateInstantEvalRequestTokens,
  estimateJudgedTextTokens,
  estimateTokensFromBytes,
  instantEvalQuestionTokens,
  instantEvalTextBudget,
  prepareInstantEvalText,
} from "../instant-eval-token-budget.rules.ts";

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

    /** @scenario "A text past its budget is cut rather than refused" */
    it("keeps the opening and the ending, with a marker between them", () => {
      const prepared = prepareInstantEvalText({
        text: `User: I want a refund. ${"filler. ".repeat(1_000)}Assistant: refund issued.`,
        budgetTokens: 200,
      });

      expect(prepared.text.startsWith("User: I want a refund.")).toBe(true);
      expect(prepared.text.endsWith("Assistant: refund issued.")).toBe(true);
      expect(prepared.text).toMatch(/tokens omitted from the middle/);
    });

    /** @scenario "A text is cut at the densest ratio judged text has shown" */
    it("cuts it to the budget times the densest measured bytes per token", () => {
      const prepared = prepareInstantEvalText({
        text: `User: I want a refund. ${"filler. ".repeat(10_000)}Assistant: refund issued.`,
        budgetTokens: 1_000,
      });

      const bytes = new TextEncoder().encode(prepared.text).length;
      expect(bytes).toBeLessThanOrEqual(
        1_000 * INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken,
      );
      expect(bytes).toBeGreaterThan(900 * INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken);
      expect(prepared.text).toMatch(/\[\.\.\. \d+ tokens omitted from the middle/);
    });

    /** @scenario "A text is cut at the densest ratio judged text has shown" */
    it("sends whole a text that fits at the densest ratio", () => {
      const text = "x".repeat(1_000 * INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken);

      expect(prepareInstantEvalText({ text, budgetTokens: 1_000 })).toEqual({
        text,
        isTruncated: false,
      });
    });

    it("leaves a text inside its budget exactly as it was", () => {
      const prepared = prepareInstantEvalText({ text: "short enough", budgetTokens: 100 });

      expect(prepared).toEqual({ text: "short enough", isTruncated: false });
    });

    /** @scenario "An unbounded conversation past the judge's state cap is cut to the budget and marked truncated" */
    it("cuts on a character boundary rather than inside a multi-byte character", () => {
      const prepared = prepareInstantEvalText({ text: "🙂".repeat(100), budgetTokens: 10 });

      expect(prepared.isTruncated).toBe(true);
      expect(prepared.text).not.toContain("�");
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

describe("given a text the judge refused as too large", () => {
  describe("when it is cut for the retry", () => {
    /** @scenario "The too-large retry cuts enough for a text denser than any measured" */
    it("cuts it to the budget at a ratio below any judged text measured", () => {
      const text = `OPENING ${"filler. ".repeat(20_000)}ENDING`;

      const cut = cutInstantEvalTextForRetry({ text, budgetTokens: 1_000 });

      const bytes = new TextEncoder().encode(cut).length;
      expect(bytes).toBeLessThanOrEqual(
        1_000 * INSTANT_EVAL_CLASSIFIER_LIMITS.retryBytesPerInputToken,
      );
      expect(cut.startsWith("OPENING")).toBe(true);
      expect(cut.endsWith("ENDING")).toBe(true);
    });

    /** @scenario "A text the classifier refuses as too large is cut once and retried" */
    it("keeps at most three quarters of a text already under that", () => {
      const text = `OPENING ${"filler. ".repeat(100)}ENDING`;

      const cut = cutInstantEvalTextForRetry({ text, budgetTokens: 30_000 });

      expect(cut.length).toBeLessThanOrEqual(text.length * 0.75);
      expect(cut.endsWith("ENDING")).toBe(true);
    });
  });
});
