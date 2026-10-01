/**
 * A run's questions are read off the run row, so a finished run reports what
 * was asked rather than today's catalogue.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import type { LangWatchQLJudgementCall } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_DEFAULT_THRESHOLD,
  instantEvalRunQuestions,
  readInstantEvalRunQuestions,
} from "../instant-eval-run-questions.rules.ts";

const stored = [
  {
    id: "annoyed",
    function: "eval",
    kind: "boolean",
    reads: "probability",
    question: {
      id: "annoyed",
      kind: "boolean",
      instructions: "The customer sounds annoyed",
      criteria: ["sarcasm counts", "a calm complaint does not"],
    },
    threshold: INSTANT_EVAL_DEFAULT_THRESHOLD,
  },
  {
    id: "helpfulness",
    function: "eval_score",
    kind: "score",
    reads: "score",
    question: {
      id: "helpfulness",
      kind: "score",
      instructions: "How helpful was the answer",
      range: { min: 1, max: 5 },
    },
  },
  {
    id: "intent",
    function: "eval_category",
    kind: "category",
    reads: "label",
    question: {
      id: "intent",
      kind: "category",
      instructions: "What is the customer asking for",
      options: [{ name: "refund", description: "wants money back" }],
    },
  },
];

describe("given the questions stored on a run", () => {
  describe("when they are read back", () => {
    /** @scenario "A statement that projects a trace id and a judged column is accepted" */
    it("names each question by the column its call was aliased to", () => {
      const questions = readInstantEvalRunQuestions(stored);

      expect(questions.map((question) => question.id)).toEqual([
        "annoyed",
        "helpfulness",
        "intent",
      ]);
    });

    it("carries the kind and the reading each function published", () => {
      const questions = readInstantEvalRunQuestions(stored);

      expect(questions.map((question) => [question.kind, question.reads])).toEqual([
        ["boolean", "probability"],
        ["score", "score"],
        ["category", "label"],
      ]);
    });

    it("rebuilds the question the classifier was asked, narrowed by its kind", () => {
      const [boolean, score, category] = readInstantEvalRunQuestions(stored);

      expect(boolean?.question).toEqual({
        id: "annoyed",
        kind: "boolean",
        instructions: "The customer sounds annoyed",
        criteria: ["sarcasm counts", "a calm complaint does not"],
      });
      expect(score?.question).toMatchObject({ kind: "score", range: { min: 1, max: 5 } });
      expect(category?.question).toMatchObject({
        kind: "category",
        options: [{ name: "refund", description: "wants money back" }],
      });
    });

    it("takes the threshold the statement wrote, and gives the others none", () => {
      const questions = readInstantEvalRunQuestions(stored);

      expect(questions.map((question) => question.threshold)).toEqual([
        INSTANT_EVAL_DEFAULT_THRESHOLD,
        undefined,
        undefined,
      ]);
    });

    it("survives a JSON round trip, which is how the column is stored", () => {
      const questions = readInstantEvalRunQuestions(stored);

      expect(readInstantEvalRunQuestions(JSON.parse(JSON.stringify(questions)))).toEqual(questions);
    });
  });

  describe("when the column carries something that is not a question list", () => {
    it("answers with none rather than refusing the run", () => {
      expect(readInstantEvalRunQuestions({ not: "a list" })).toEqual([]);
      expect(readInstantEvalRunQuestions(null)).toEqual([]);
      expect(readInstantEvalRunQuestions([{ id: "x", kind: "mood" }])).toEqual([]);
    });
  });
});

describe("instantEvalRunQuestions, given what the statement's judged columns ask", () => {
  const judgement = (call: LangWatchQLJudgementCall) => call;

  describe("when a boolean column carries its own threshold", () => {
    it("stores the question addressed by the column it comes back in", () => {
      expect(
        instantEvalRunQuestions([
          judgement({
            column: "annoyed",
            function: "eval_passed",
            reads: "passed",
            threshold: 0.8,
            kind: "boolean",
            instructions: "The customer sounds annoyed",
            criteria: ["annoyed", "calm"],
          }),
        ]),
      ).toEqual([
        {
          id: "annoyed",
          function: "eval_passed",
          kind: "boolean",
          reads: "passed",
          threshold: 0.8,
          question: {
            id: "annoyed",
            kind: "boolean",
            instructions: "The customer sounds annoyed",
            criteria: ["annoyed", "calm"],
          },
        },
      ]);
    });
  });

  describe("when a score and a category column are asked", () => {
    it("stores each one's own bounds, and no threshold", () => {
      expect(
        instantEvalRunQuestions([
          judgement({
            column: "helpful",
            function: "eval_score",
            reads: "score",
            kind: "score",
            instructions: "How helpful",
            range: { min: 1, max: 5 },
          }),
          judgement({
            column: "topic",
            function: "eval_category",
            reads: "label",
            kind: "category",
            instructions: "What is it about",
            options: [{ name: "refund", description: "wants money back" }],
          }),
        ]),
      ).toEqual([
        {
          id: "helpful",
          function: "eval_score",
          kind: "score",
          reads: "score",
          question: {
            id: "helpful",
            kind: "score",
            instructions: "How helpful",
            range: { min: 1, max: 5 },
          },
        },
        {
          id: "topic",
          function: "eval_category",
          kind: "category",
          reads: "label",
          question: {
            id: "topic",
            kind: "category",
            instructions: "What is it about",
            options: [{ name: "refund", description: "wants money back" }],
          },
        },
      ]);
    });
  });

  describe("when the statement judges nothing", () => {
    it("asks nothing, which is what the create path refuses on", () => {
      expect(instantEvalRunQuestions([])).toEqual([]);
    });
  });
});
