/**
 * The question one eval call asks, located by parameter name rather than by
 * position, so a function that gains an argument shifts nothing.
 * @see specs/lwql/eval-functions.feature
 */

import type { LangWatchQLAppFunctionCall } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { langWatchQLJudgementCalls } from "../langwatch-ql-judgement-questions.rules.ts";

const call = (
  overrides: Partial<LangWatchQLAppFunctionCall> & Pick<LangWatchQLAppFunctionCall, "function">,
): LangWatchQLAppFunctionCall => ({
  column: "annoyed",
  options: [],
  ...overrides,
});

const only = (calls: readonly LangWatchQLAppFunctionCall[]) => {
  const [first] = langWatchQLJudgementCalls(calls);
  if (!first) throw new Error("expected one judgement");

  return first;
};

describe("langWatchQLJudgementCalls, given a hydration plan", () => {
  describe("when the plan names no eval function", () => {
    it("asks nothing, which is what a run refuses on", () => {
      expect(
        langWatchQLJudgementCalls([call({ function: "conversation", options: [8000, ""] })]),
      ).toEqual([]);
    });

    it("asks nothing for a function the catalogue does not declare", () => {
      expect(langWatchQLJudgementCalls([call({ function: "not_a_function" })])).toEqual([]);
    });
  });

  describe("when the plan calls eval", () => {
    it("asks a boolean question read as a probability, at an even chance", () => {
      expect(only([call({ function: "eval", options: ["The customer sounds annoyed"] })])).toEqual({
        column: "annoyed",
        function: "eval",
        kind: "boolean",
        reads: "probability",
        instructions: "The customer sounds annoyed",
        threshold: 0.5,
      });
    });
  });

  describe("when the plan calls eval_criteria", () => {
    it("carries what counts as yes and what counts as no", () => {
      expect(
        only([
          call({
            function: "eval_criteria",
            options: ["Did the agent resolve it", ["resolved", "still open"]],
          }),
        ]),
      ).toMatchObject({ kind: "boolean", criteria: ["resolved", "still open"] });
    });
  });

  describe("when the plan calls eval_passed", () => {
    it("reads the column as a pass at the threshold the caller named", () => {
      expect(only([call({ function: "eval_passed", options: ["Is it rude", 0.8] })])).toMatchObject(
        { reads: "passed", threshold: 0.8 },
      );
    });
  });

  describe("when the plan calls eval_score", () => {
    it("carries both ends of the scale", () => {
      expect(
        only([call({ function: "eval_score", options: ["How helpful", 1, 5] })]),
      ).toMatchObject({ kind: "score", reads: "score", range: { min: 1, max: 5 } });
    });

    it("refuses a call the validator should have refused, rather than asking half a scale", () => {
      expect(() => langWatchQLJudgementCalls([call({ function: "eval_score" })])).toThrow(
        /both ends of its scale/,
      );
    });
  });

  describe("when the plan calls eval_category", () => {
    it("splits each option at its first colon into a name and a gloss", () => {
      expect(
        only([
          call({
            function: "eval_category",
            options: [
              "What is it about",
              ["refund: wants money back: really", "billing: an invoice question"],
            ],
          }),
        ]),
      ).toMatchObject({
        kind: "category",
        reads: "label",
        options: [
          { name: "refund", description: "wants money back: really" },
          { name: "billing", description: "an invoice question" },
        ],
      });
    });
  });

  describe("when the plan calls several", () => {
    it("answers one judgement per call, in projection order", () => {
      expect(
        langWatchQLJudgementCalls([
          call({ column: "annoyed", function: "eval", options: ["annoyed"] }),
          call({ column: "conversation", function: "conversation", options: [8000, ""] }),
          call({ column: "helpful", function: "eval_score", options: ["helpful", 1, 5] }),
        ]).map((judgement) => judgement.column),
      ).toEqual(["annoyed", "helpful"]);
    });
  });
});
