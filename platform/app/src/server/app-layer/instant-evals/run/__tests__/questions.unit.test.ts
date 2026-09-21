/**
 * A run's questions are read off the statement, not sent by the caller.
 *
 * @see ../questions.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLAppFunctionCall } from "~/server/analytics/lwql";
import {
  INSTANT_EVAL_DEFAULT_THRESHOLD,
  instantEvalRunQuestions,
  readInstantEvalRunQuestions,
} from "../questions";

const annoyed: LangWatchQLAppFunctionCall = {
  column: "annoyed",
  function: "eval",
  options: ["The customer sounds annoyed"],
  source: {
    function: "conversation_bounded",
    options: [8000, ""],
  },
};

const intent: LangWatchQLAppFunctionCall = {
  column: "intent",
  function: "eval_category",
  options: [
    "What is the customer asking for",
    ["refund: wants money back", "bug: reports something broken"],
  ],
  source: { function: "conversation_bounded", options: [8000, ""] },
};

const passedAtSeventy: LangWatchQLAppFunctionCall = {
  column: "clear",
  function: "eval_passed",
  options: ["The answer was clear", 0.7],
};

const rated: LangWatchQLAppFunctionCall = {
  column: "helpfulness",
  function: "eval_score",
  options: ["How helpful was the answer", 1, 5],
};

const text: LangWatchQLAppFunctionCall = {
  column: "conversation",
  function: "conversation_bounded",
  options: [8000, ""],
};

describe("given a validated statement's app-function plan", () => {
  describe("when the questions are derived", () => {
    /** @scenario "A statement that projects a trace id and a judged column is accepted" */
    it("names each question by the column its call was aliased to", () => {
      const questions = instantEvalRunQuestions([annoyed, intent]);

      expect(questions.map((question) => question.id)).toEqual([
        "annoyed",
        "intent",
      ]);
    });

    it("carries the kind and the reading each function publishes", () => {
      const questions = instantEvalRunQuestions([annoyed, intent, rated]);

      expect(
        questions.map((question) => [question.kind, question.reads]),
      ).toEqual([
        ["boolean", "probability"],
        ["category", "label"],
        ["score", "score"],
      ]);
    });

    it("builds the question the classifier is asked", () => {
      const [question] = instantEvalRunQuestions([intent]);

      expect(question?.question).toMatchObject({
        id: "intent",
        kind: "category",
        instructions: "What is the customer asking for",
        options: [
          { name: "refund", description: "wants money back" },
          { name: "bug", description: "reports something broken" },
        ],
      });
    });

    it("leaves out an extraction function, which asks nothing", () => {
      expect(instantEvalRunQuestions([text, annoyed])).toHaveLength(1);
    });

    it("leaves out a call naming no catalogued function", () => {
      expect(
        instantEvalRunQuestions([
          { column: "x", function: "not_a_function", options: [] },
        ]),
      ).toEqual([]);
    });
  });

  describe("when the question carries a threshold", () => {
    it("takes the one the statement wrote", () => {
      const [question] = instantEvalRunQuestions([passedAtSeventy]);

      expect(question?.threshold).toBe(0.7);
    });

    it("takes an even chance where the statement named none", () => {
      const [question] = instantEvalRunQuestions([annoyed]);

      expect(question?.threshold).toBe(INSTANT_EVAL_DEFAULT_THRESHOLD);
    });

    it("gives a score and a category no threshold at all", () => {
      const questions = instantEvalRunQuestions([intent, rated]);

      expect(questions.map((question) => question.threshold)).toEqual([
        undefined,
        undefined,
      ]);
    });
  });
});

describe("given the questions stored on a run", () => {
  describe("when they are read back", () => {
    it("returns what was stored", () => {
      const stored = instantEvalRunQuestions([annoyed, rated]);

      expect(
        readInstantEvalRunQuestions(JSON.parse(JSON.stringify(stored))),
      ).toEqual(stored);
    });

    it("returns nothing for a column that is not a question list", () => {
      expect(readInstantEvalRunQuestions({ not: "a list" })).toEqual([]);
      expect(readInstantEvalRunQuestions(null)).toEqual([]);
    });
  });
});
