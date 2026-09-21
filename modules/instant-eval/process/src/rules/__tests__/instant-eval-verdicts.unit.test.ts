/**
 * What a judged cell means, per question kind, and what counts as a match.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import type { InstantEvalRunQuestion } from "../instant-eval-run-questions.rules.ts";
import {
  countsForQuestion,
  EMPTY_INSTANT_EVAL_VERDICT,
  isBooleanMatch,
  verdictOf,
} from "../instant-eval-verdicts.rules.ts";

const question = (overrides: Partial<InstantEvalRunQuestion>): InstantEvalRunQuestion => ({
  id: "annoyed",
  function: "eval",
  kind: "boolean",
  reads: "probability",
  question: { id: "annoyed", kind: "boolean", instructions: "The customer sounds annoyed" },
  ...overrides,
});

describe("verdictOf, given a judged cell", () => {
  describe("when the question reads a probability", () => {
    it("passes at or above the question's own threshold", () => {
      const asked = question({ threshold: 0.8 });

      expect(verdictOf({ question: asked, cell: 0.8 })).toMatchObject({
        probability: 0.8,
        passed: 1,
      });
      expect(verdictOf({ question: asked, cell: 0.79 })).toMatchObject({
        probability: 0.79,
        passed: 0,
      });
    });

    it("draws the line at an even chance when the question named none", () => {
      expect(verdictOf({ question: question({}), cell: 0.5 })).toMatchObject({ passed: 1 });
      expect(verdictOf({ question: question({}), cell: 0.49 })).toMatchObject({ passed: 0 });
    });

    it("records a cell that is not a number as judged with no value", () => {
      expect(verdictOf({ question: question({}), cell: "yes" })).toEqual(
        EMPTY_INSTANT_EVAL_VERDICT,
      );
    });
  });

  describe("when the question reads a pass of its own", () => {
    it("takes the cell as the pass and leaves the probability empty", () => {
      const asked = question({ function: "eval_passed", reads: "passed" });

      expect(verdictOf({ question: asked, cell: 1 })).toMatchObject({
        passed: 1,
        probability: null,
      });
    });
  });

  describe("when the question reads a score", () => {
    it("takes the cell as the score", () => {
      const asked = question({ kind: "score", function: "eval_score", reads: "score" });

      expect(verdictOf({ question: asked, cell: 4 })).toMatchObject({ score: 4, passed: null });
    });
  });

  describe("when the question reads a label", () => {
    it("takes a non-empty cell as the label and an empty one as none", () => {
      const asked = question({ kind: "category", function: "eval_category", reads: "label" });

      expect(verdictOf({ question: asked, cell: "billing" })).toMatchObject({ label: "billing" });
      expect(verdictOf({ question: asked, cell: "" })).toMatchObject({ label: "" });
    });
  });

  describe("when the question reads the whole distribution", () => {
    it("takes the cell as the encoded probabilities", () => {
      const asked = question({
        kind: "category",
        function: "eval_category_probs",
        reads: "probabilities",
      });

      expect(verdictOf({ question: asked, cell: '{"billing":0.7}' })).toMatchObject({
        probabilities: '{"billing":0.7}',
      });
    });
  });
});

describe("given a judged verdict", () => {
  describe("when the matches are counted", () => {
    it("counts a boolean only when it passed", () => {
      const asked = question({});

      expect(
        isBooleanMatch({ question: asked, verdict: verdictOf({ question: asked, cell: 0.9 }) }),
      ).toBe(true);
      expect(
        isBooleanMatch({ question: asked, verdict: verdictOf({ question: asked, cell: 0.1 }) }),
      ).toBe(false);
    });

    it("never counts a score or a category as a boolean match", () => {
      const scored = question({ kind: "score", function: "eval_score", reads: "score" });

      expect(
        isBooleanMatch({ question: scored, verdict: verdictOf({ question: scored, cell: 4 }) }),
      ).toBe(false);
    });

    it("counts a score or a category as answered rather than matched", () => {
      const scored = question({ kind: "score", function: "eval_score", reads: "score" });
      const labelled = question({
        kind: "category",
        function: "eval_category",
        reads: "label",
      });

      expect(
        countsForQuestion({ question: scored, verdict: verdictOf({ question: scored, cell: 4 }) }),
      ).toBe(true);
      expect(
        countsForQuestion({
          question: labelled,
          verdict: verdictOf({ question: labelled, cell: "billing" }),
        }),
      ).toBe(true);
      expect(
        countsForQuestion({
          question: labelled,
          verdict: verdictOf({ question: labelled, cell: "" }),
        }),
      ).toBe(false);
    });
  });
});
