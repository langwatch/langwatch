/**
 * The question and answer shapes, against the API measured in September 2026.
 * Every response fixture is a body the live classifier returned.
 * @see modules/instant-eval/specs/classifier.feature
 */

import { describe, expect, it } from "vitest";

import {
  classifierResponseSchema,
  readClassifierVerdicts,
  toClassifierQuestions,
} from "../instant-eval-classifier-wire.ts";
import type { InstantEvalQuestion } from "../instant-eval-judge.api.ts";

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
          criteria: ["sarcasm or repetition counts", "a calm complaint does not"],
        },
      ]);

      expect(wire.annoyed).toMatchObject({
        criteria: { true: "sarcasm or repetition counts", false: "a calm complaint does not" },
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
        legend: { "0": "1", "1": "2", "2": "3", "3": "4", "4": "5" },
        probabilities: { "0": 0.06, "1": 0.63, "2": 0.3, "3": 0.01, "4": 0 },
      },
    },
    usage: { input_tokens: 514, output_tokens: 86 },
  });

  describe("when the verdicts are read", () => {
    const verdicts = readClassifierVerdicts({ questions: [BOOLEAN, SCORE, CATEGORY], response });

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

    /** @scenario "A score verdict is the probability-weighted mean of its levels" */
    it("keeps the levels' weighted standard deviation as the score's spread", () => {
      const mean = 2.26;
      const variance =
        0.06 * (1 - mean) ** 2 +
        0.63 * (2 - mean) ** 2 +
        0.3 * (3 - mean) ** 2 +
        0.01 * (4 - mean) ** 2;
      expect(verdicts[1]?.spread).toBeCloseTo(Math.sqrt(variance), 10);
    });

    /** @scenario "A category verdict is the most likely option and its probability" */
    it("reads a category as its label, keeping the distribution", () => {
      expect(verdicts[2]?.label).toBe("refund");
      expect(verdicts[2]?.probabilities).toEqual({ other: 0.1, bug: 0.2, refund: 0.7 });
    });
  });

  describe("when the classifier answers a question that was not asked", () => {
    it("drops the stray answer rather than inventing a column for it", () => {
      const strayResponse = classifierResponseSchema.parse({
        answers: { somethingElse: { type: "noul", noul: 0.5 } },
      });

      expect(readClassifierVerdicts({ questions: [BOOLEAN], response: strayResponse })).toEqual([]);
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

      const [verdict] = readClassifierVerdicts({ questions: [CATEGORY], response: oddResponse });

      expect(verdict?.label).toBe("bug");
    });
  });
});

describe("given a score answer captured from the live API", () => {
  const captured = classifierResponseSchema.parse({
    model: "jev-1.13.0",
    answers: {
      rating: {
        type: "score",
        score: 3.67,
        confidence: 0.73,
        legend: { "0": "20", "1": "21", "2": "22", "3": "23", "4": "24" },
        probabilities: { "0": 0, "1": 0, "2": 0.01, "3": 0.3, "4": 0.69 },
      },
    },
    usage: { input_tokens: 335, output_tokens: 17 },
  });

  const rating: InstantEvalQuestion = {
    id: "rating",
    kind: "score",
    instructions: "Rate the review from 20 for awful to 24 for glowing",
    range: { min: 20, max: 24 },
  };

  describe("when the verdict is read", () => {
    /** @scenario "A score verdict is the probability-weighted mean of its levels" */
    it("answers inside the declared range rather than at a level index", () => {
      const [verdict] = readClassifierVerdicts({ questions: [rating], response: captured });

      expect(verdict?.score).toBeCloseTo(23.68, 10);
    });
  });

  describe("when the keys are the levels themselves rather than positions", () => {
    it("reads them as levels, so a change of key shape keeps the same answer", () => {
      const byLevel = classifierResponseSchema.parse({
        answers: {
          rating: { type: "score", probabilities: { "22": 0.01, "23": 0.3, "24": 0.69 } },
        },
      });

      const [verdict] = readClassifierVerdicts({ questions: [rating], response: byLevel });

      expect(verdict?.score).toBeCloseTo(23.68, 10);
    });
  });

  describe("when a probability names a level that was never offered", () => {
    it("drops it rather than weighing the mean towards it", () => {
      const stray = classifierResponseSchema.parse({
        answers: { rating: { type: "score", legend: { "9": "900" }, probabilities: { "9": 1 } } },
      });

      const [verdict] = readClassifierVerdicts({ questions: [rating], response: stray });

      expect(verdict).toBeUndefined();
    });
  });
});

describe("given a score question that names its levels", () => {
  const difficulty: InstantEvalQuestion = {
    id: "difficulty",
    kind: "score",
    instructions: "How hard is this case",
    range: { min: 0, max: 2 },
    levels: ["easy: one read decides it", "medium: needs care", "very hard: buried evidence"],
  };
  const read = (answer: Record<string, unknown>) =>
    readClassifierVerdicts({
      questions: [difficulty],
      response: classifierResponseSchema.parse({ answers: { difficulty: answer } }),
    })[0]?.score;

  /** @scenario "The gate reads a frozen framing of the case" */
  it("sends the names as the criteria in place of the numbers", () => {
    expect(toClassifierQuestions([difficulty]).difficulty).toEqual({
      type: "score",
      instructions: "How hard is this case",
      criteria: ["easy: one read decides it", "medium: needs care", "very hard: buried evidence"],
    });
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("reads the weighted mean level index from position keys", () => {
    expect(read({ type: "score", probabilities: { "0": 0.5, "1": 0.3, "2": 0.2 } })).toBeCloseTo(
      0.7,
      10,
    );
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("reads the same mean through a legend that names the levels sent", () => {
    const legend = {
      a: "easy: one read decides it",
      b: "medium: needs care",
      c: "very hard: buried evidence",
    };
    expect(read({ type: "score", legend, probabilities: { a: 0.5, b: 0.3, c: 0.2 } })).toBeCloseTo(
      0.7,
      10,
    );
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("reads keys that are the levels' labels, whole or with their description", () => {
    expect(
      read({
        type: "score",
        probabilities: { easy: 0.5, "medium: needs care": 0.3, "very hard": 0.2 },
      }),
    ).toBeCloseTo(0.7, 10);
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("reads a level's label followed by a description other than the one sent", () => {
    expect(
      read({
        type: "score",
        probabilities: { easy: 0.5, "medium: careful reading": 0.3, "very hard": 0.2 },
      }),
    ).toBeCloseTo(0.7, 10);
    expect(
      read({
        type: "score",
        legend: { a: "easy", b: "medium: other wording", c: "very hard" },
        probabilities: { a: 0.5, b: 0.3, c: 0.2 },
      }),
    ).toBeCloseTo(0.7, 10);
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("reads a label in another case or with surrounding space as that level", () => {
    expect(
      read({ type: "score", probabilities: { " Easy": 0.5, MEDIUM: 0.3, "Very Hard ": 0.2 } }),
    ).toBeCloseTo(0.7, 10);
    expect(
      read({
        type: "score",
        legend: { a: "EASY", b: " Medium: other wording", c: "very hard" },
        probabilities: { a: 0.5, b: 0.3, c: 0.2 },
      }),
    ).toBeCloseTo(0.7, 10);
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("reads a whole level name before a label it shares, and no level from a shared label", () => {
    const risk: InstantEvalQuestion = {
      ...difficulty,
      range: { min: 0, max: 1 },
      levels: ["risk: low", "risk: high"],
    };
    const readRisk = (probabilities: Record<string, number>) =>
      readClassifierVerdicts({
        questions: [risk],
        response: classifierResponseSchema.parse({
          answers: { difficulty: { type: "score", probabilities } },
        }),
      })[0]?.score;

    expect(readRisk({ "risk: high": 1 })).toBe(1);
    expect(readRisk({ " Risk: Low": 1 })).toBe(0);
    expect(readRisk({ risk: 1 })).toBeUndefined();
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("refuses to send names whose range is not 0 to the last level index", () => {
    expect(() => toClassifierQuestions([{ ...difficulty, range: { min: 1, max: 10 } }])).toThrow(
      /range must be 0 to 2, not 1 to 10/,
    );
    expect(() => toClassifierQuestions([{ ...difficulty, range: { min: 0, max: 4 } }])).toThrow(
      /range must be 0 to 2/,
    );
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("takes a bare score as the level index, and drops a key that names no level", () => {
    expect(read({ type: "score", score: 1.4 })).toBe(1.4);
    expect(read({ type: "score", probabilities: { "": 1, harder: 1 } })).toBeUndefined();
  });
});
