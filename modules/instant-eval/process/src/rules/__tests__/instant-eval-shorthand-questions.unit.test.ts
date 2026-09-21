/**
 * The eval call each kind of question becomes, and the refusals for a
 * question whose fields belong to another kind.
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import type {
  InstantEvalShorthandInput,
  InstantEvalShorthandQuestion,
} from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { expandInstantEvalShorthand } from "../instant-eval-shorthand.rules.ts";

const NOW = Temporal.Instant.from("2026-09-18T12:00:00.000Z");

const ask = (
  question: Partial<InstantEvalShorthandQuestion> = {},
): InstantEvalShorthandQuestion => ({
  kind: "boolean",
  instructions: "The customer sounds annoyed",
  ...question,
});

const expand = (shorthand: Partial<InstantEvalShorthandInput> = {}) =>
  expandInstantEvalShorthand({
    shorthand: { target: "traces", questions: [ask()], ...shorthand },
    database: "analytics",
    now: NOW,
  });

describe("given one question of each kind", () => {
  describe("when the question is a plain yes or no", () => {
    /** @scenario "A boolean question becomes an eval call" */
    it("calls eval", () => {
      expect(expand().sql).toContain(
        "eval(llm_readable_trace(TraceId, 8000), 'The customer sounds annoyed') AS q1",
      );
    });
  });

  describe("when the question carries two criteria", () => {
    /** @scenario "A boolean question with two criteria becomes an eval_criteria call" */
    it("calls eval_criteria with both, in order", () => {
      const { sql } = expand({
        questions: [ask({ criteria: ["sarcasm counts", "a calm complaint does not"] })],
      });

      expect(sql).toContain(
        "eval_criteria(llm_readable_trace(TraceId, 8000), 'The customer sounds annoyed', ['sarcasm counts', 'a calm complaint does not'])",
      );
    });
  });

  describe("when the question carries a threshold", () => {
    /** @scenario "A boolean question with a threshold becomes an eval_passed call" */
    it("calls eval_passed with it", () => {
      const { sql } = expand({ questions: [ask({ threshold: 0.7 })] });

      expect(sql).toContain(
        "eval_passed(llm_readable_trace(TraceId, 8000), 'The customer sounds annoyed', 0.7)",
      );
    });

    it("writes a whole threshold with a decimal point", () => {
      expect(expand({ questions: [ask({ threshold: 1 })] }).sql).toContain(", 1.0)");
    });
  });

  describe("when the question carries criteria and a threshold together", () => {
    /** @scenario "A boolean question carrying both criteria and a threshold is refused" */
    it("refuses and names both forms", () => {
      expect(() =>
        expand({ questions: [ask({ criteria: ["yes", "no"], threshold: 0.7 })] }),
      ).toThrow(/criteria or a threshold, not both/);
    });
  });

  describe("when the question is a score", () => {
    /** @scenario "A score question becomes an eval_score call over its range" */
    it("calls eval_score over both ends of the range", () => {
      const { sql } = expand({
        questions: [
          ask({
            kind: "score",
            instructions: "How satisfied is the customer",
            range: { min: 1, max: 5 },
          }),
        ],
      });

      expect(sql).toContain(
        "eval_score(llm_readable_trace(TraceId, 8000), 'How satisfied is the customer', 1, 5)",
      );
    });

    it("refuses a range with too many levels", () => {
      expect(() =>
        expand({ questions: [ask({ kind: "score", range: { min: 0, max: 20 } })] }),
      ).toThrow(/at most 10 levels/);
    });

    it("refuses a range that runs backwards", () => {
      expect(() =>
        expand({ questions: [ask({ kind: "score", range: { min: 5, max: 1 } })] }),
      ).toThrow(/runs upwards/);
    });
  });

  describe("when the question is a category", () => {
    /** @scenario "A category question becomes an eval_category call over its options" */
    it("calls eval_category with each option as a name and a meaning", () => {
      const { sql } = expand({
        questions: [
          ask({
            kind: "category",
            instructions: "What is being asked for",
            options: [
              { name: "refund", description: "wants money back" },
              { name: "bug", description: "something is broken" },
            ],
          }),
        ],
      });

      expect(sql).toContain(
        "eval_category(llm_readable_trace(TraceId, 8000), 'What is being asked for', ['refund: wants money back', 'bug: something is broken'])",
      );
    });

    it("refuses an option whose name carries a colon", () => {
      expect(() =>
        expand({
          questions: [
            ask({
              kind: "category",
              options: [
                { name: "a:b", description: "one" },
                { name: "c", description: "two" },
              ],
            }),
          ],
        }),
      ).toThrow(/cannot name an option/);
    });
  });

  describe("when a question carries a field of another kind", () => {
    it("refuses rather than expanding a question the caller did not write", () => {
      expect(() =>
        expand({ questions: [ask({ kind: "score", range: { min: 1, max: 5 }, threshold: 0.5 })] }),
      ).toThrow(/no use for threshold/);
    });
  });
});
