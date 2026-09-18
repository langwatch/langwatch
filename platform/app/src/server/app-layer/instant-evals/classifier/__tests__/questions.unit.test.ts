/**
 * The question and answer shapes, against the API measured in September 2026.
 *
 * Every response fixture here is a real body the live classifier returned, so
 * a drift in what it sends back fails here rather than in production.
 *
 * @see ../questions.ts
 * @see specs/instant-evals/classifier.feature
 */

import { describe, expect, it } from "vitest";

import type { InstantEvalQuestion } from "../classifier";
import {
  classifierResponseSchema,
  readClassifierVerdicts,
  toClassifierQuestions,
} from "../questions";

const BOOLEAN: InstantEvalQuestion = {
  id: "annoyed",
  kind: "boolean",
  instructions: "The customer sounds annoyed",
};

const SCORE: InstantEvalQuestion = {
  id: "satisfaction",
  kind: "score",
  instructions: "How satisfied is the customer",
  range: { min: 1, max: 5 },
};

const CATEGORY: InstantEvalQuestion = {
  id: "intent",
  kind: "category",
  instructions: "What is the customer asking for",
  options: [
    { name: "refund", description: "wants money back" },
    { name: "bug", description: "reports something broken" },
    { name: "other", description: "anything else" },
  ],
};

describe("given the three question kinds over one text", () => {
  describe("when they are put on the wire", () => {
    /** @scenario "Each question kind is sent in the shape the classifier names it" */
    it("names each kind the way the classifier does, in one keyed object", () => {
      const wire = toClassifierQuestions([BOOLEAN, SCORE, CATEGORY]);

      expect(Object.keys(wire)).toEqual(["annoyed", "satisfaction", "intent"]);
      expect(wire.annoyed).toEqual({
        type: "noul",
        instructions: "The customer sounds annoyed",
      });
      expect(wire.satisfaction).toEqual({
        type: "score",
        instructions: "How satisfied is the customer",
        criteria: ["1", "2", "3", "4", "5"],
      });
      expect(wire.intent).toEqual({
        type: "choice",
        instructions: "What is the customer asking for",
        criteria: {
          refund: "wants money back",
          bug: "reports something broken",
          other: "anything else",
        },
      });
    });
  });

  describe("when the boolean question carries criteria", () => {
    /** @scenario "A boolean question with criteria carries what counts as yes and what does not" */
    it("puts the two sides on the keys the classifier reads them from", () => {
      const wire = toClassifierQuestions([
        {
          ...BOOLEAN,
          kind: "boolean",
          criteria: [
            "sarcasm or repetition counts",
            "a calm complaint does not",
          ],
        },
      ]);

      expect(wire.annoyed).toMatchObject({
        criteria: {
          true: "sarcasm or repetition counts",
          false: "a calm complaint does not",
        },
      });
    });
  });
});

describe("given a response from the classifier", () => {
  const response = classifierResponseSchema.parse({
    model: "jev-1.13.0",
    answers: {
      intent: {
        type: "choice",
        choice: "refund",
        confidence: 1,
        probabilities: { other: 0.1, bug: 0.2, refund: 0.7 },
      },
      annoyed: { type: "noul", noul: 0.96 },
      satisfaction: {
        type: "score",
        score: 1.26,
        confidence: 0.68,
        probabilities: { "0": 0.06, "1": 0.63, "2": 0.3, "3": 0.01, "4": 0 },
      },
    },
    usage: { input_tokens: 514, output_tokens: 86 },
  });

  describe("when the verdicts are read", () => {
    const verdicts = readClassifierVerdicts({
      questions: [BOOLEAN, SCORE, CATEGORY],
      response,
    });

    /** @scenario "Answers are matched to questions by id rather than by order" */
    it("gives each question the answer its own id names", () => {
      expect(verdicts.map((verdict) => verdict.questionId)).toEqual([
        "annoyed",
        "satisfaction",
        "intent",
      ]);
    });

    /** @scenario "A boolean verdict is a probability, and passing is the probability against the threshold" */
    it("reads a boolean as the probability of yes", () => {
      expect(verdicts[0]?.probability).toBe(0.96);
    });

    /** @scenario "A score verdict is the probability-weighted mean of its levels" */
    it("reads a score as the probability-weighted mean of the levels", () => {
      expect(verdicts[1]?.score).toBeCloseTo(2.26, 10);
    });

    /** @scenario "A category verdict is the most likely option and its probability" */
    it("reads a category as its label, keeping the distribution", () => {
      expect(verdicts[2]?.label).toBe("refund");
      expect(verdicts[2]?.probabilities).toEqual({
        other: 0.1,
        bug: 0.2,
        refund: 0.7,
      });
    });
  });

  describe("when the classifier answers a question that was not asked", () => {
    it("drops the stray answer rather than inventing a column for it", () => {
      const strayResponse = classifierResponseSchema.parse({
        answers: { somethingElse: { type: "noul", noul: 0.5 } },
      });

      expect(
        readClassifierVerdicts({
          questions: [BOOLEAN],
          response: strayResponse,
        }),
      ).toEqual([]);
    });
  });

  describe("when a category answer names an option that was not offered", () => {
    it("falls back to the most likely option that was", () => {
      const oddResponse = classifierResponseSchema.parse({
        answers: {
          intent: {
            type: "choice",
            choice: "hallucinated",
            probabilities: { refund: 0.2, bug: 0.8 },
          },
        },
      });

      const [verdict] = readClassifierVerdicts({
        questions: [CATEGORY],
        response: oddResponse,
      });
      expect(verdict?.label).toBe("bug");
    });
  });
});
