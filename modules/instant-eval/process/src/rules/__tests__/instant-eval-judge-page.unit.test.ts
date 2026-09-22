/**
 * The requests a page sends, the ceiling it may not send past, and the cells
 * the answers fill.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  InstantEvalQueryBudgetExceededError,
  InstantEvalQuestionsTooLongError,
  type InstantEvalVerdict,
} from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  assertInstantEvalPageBudget,
  instantEvalJudgedRows,
  instantEvalJudgementUnits,
  instantEvalPageTokenBudget,
} from "../instant-eval-judge-page.rules.ts";
import type { InstantEvalRunQuestion } from "../instant-eval-run-questions.rules.ts";

const LIMITS = INSTANT_EVAL_CLASSIFIER_LIMITS;

function question(overrides: Partial<InstantEvalRunQuestion> = {}): InstantEvalRunQuestion {
  const id = overrides.id ?? "annoyed";

  return {
    id,
    function: "eval_boolean",
    kind: "boolean",
    reads: "probability",
    question: { id, kind: "boolean", instructions: "was the customer annoyed?" },
    ...overrides,
  };
}

describe("given a page whose rows carry the text each question is about", () => {
  describe("when its requests are built", () => {
    it("asks every question about one text in a single request", () => {
      const units = instantEvalJudgementUnits({
        rows: [{ annoyed: "the same text", polite: "the same text" }],
        questions: [question(), question({ id: "polite" })],
        limits: LIMITS,
      });

      expect(units).toHaveLength(1);
      expect(units[0]?.questions.map((one) => one.id)).toEqual(["annoyed", "polite"]);
    });

    it("sends a request per text when the questions are about different ones", () => {
      const units = instantEvalJudgementUnits({
        rows: [{ annoyed: "the conversation", polite: "the last answer" }],
        questions: [question(), question({ id: "polite" })],
        limits: LIMITS,
      });

      expect(units.map((unit) => unit.text)).toEqual(["the conversation", "the last answer"]);
    });

    it("skips a row whose extraction found no text, which has nothing to judge", () => {
      const units = instantEvalJudgementUnits({
        rows: [{ annoyed: "" }, { annoyed: "a conversation" }],
        questions: [question()],
        limits: LIMITS,
      });

      expect(units.map((unit) => unit.rowIndex)).toEqual([1]);
    });

    it("refuses once when the questions leave no room for any text", () => {
      expect(() =>
        instantEvalJudgementUnits({
          rows: [{ annoyed: "a conversation" }],
          questions: [
            question({
              question: { id: "annoyed", kind: "boolean", instructions: "x".repeat(400_000) },
            }),
          ],
          limits: LIMITS,
        }),
      ).toThrow(InstantEvalQuestionsTooLongError);
    });
  });
});

describe("given a page that would send more text than its own rows could carry", () => {
  describe("when the page is checked against its ceiling", () => {
    it("refuses before anything is sent", () => {
      // Two questions about two different texts, each the size of the judge's
      // whole state: one row's worth of budget, two rows' worth of sending.
      const rows = [{ annoyed: "x".repeat(400_000), polite: "y".repeat(400_000) }];
      const units = instantEvalJudgementUnits({
        rows,
        questions: [question(), question({ id: "polite" })],
        limits: LIMITS,
      });

      expect(() =>
        assertInstantEvalPageBudget({
          units,
          budget: instantEvalPageTokenBudget({ rows: rows.length, limits: LIMITS }),
          limits: LIMITS,
        }),
      ).toThrow(InstantEvalQueryBudgetExceededError);
    });
  });
});

describe("given a page some of whose questions were answered", () => {
  describe("when the rows are written", () => {
    it("puts each verdict in its own column and names the rows left unanswered", () => {
      const verdict: InstantEvalVerdict = { questionId: "annoyed", probability: 0.7 };

      const judged = instantEvalJudgedRows({
        rows: [
          { TraceId: "t1", annoyed: "one" },
          { TraceId: "t2", annoyed: "two" },
          { TraceId: "t3", annoyed: "" },
        ],
        questions: [question()],
        cells: new Map([[0, new Map([["annoyed", verdict]])]]),
      });

      expect(judged.rows).toEqual([
        { TraceId: "t1", annoyed: 0.7 },
        { TraceId: "t2", annoyed: null },
        { TraceId: "t3", annoyed: null },
      ]);
      // The third row had no text to judge, so its null is the extraction's,
      // not a stop's.
      expect(judged.unjudgedRows).toEqual([1]);
    });

    it("leaves a declined question null without calling its row unjudged", () => {
      const judged = instantEvalJudgedRows({
        rows: [{ TraceId: "t1", annoyed: "one" }],
        questions: [question()],
        cells: new Map([[0, new Map([["annoyed", null]])]]),
      });

      expect(judged.rows).toEqual([{ TraceId: "t1", annoyed: null }]);
      expect(judged.unjudgedRows).toEqual([]);
    });
  });
});
