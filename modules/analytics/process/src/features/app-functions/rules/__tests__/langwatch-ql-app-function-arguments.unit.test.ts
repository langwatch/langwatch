/**
 * What an app function's arguments have to be. Driven with the parser's own
 * literal shape, because that is what the walk hands this rule.
 * @see specs/lwql/eval-functions.feature
 */

import { describe, expect, it } from "vitest";

import { readAppFunctionArguments } from "../langwatch-ql-app-function-arguments.rules.ts";
import { findLangWatchQLAppFunctions } from "../langwatch-ql-app-function-catalog.rules.ts";

const column = { type: "Identifier", name: "ConversationId" };

const text = (value: string) => ({ type: "Literal", value_type: "String", value });
const number = (value: number) => ({
  type: "Literal",
  value_type: "UInt64",
  value: String(value),
});
const list = (values: readonly string[]) => ({
  type: "Literal",
  value_type: "Array",
  value: values.map((value) => ({ value_type: "String", value })),
});

function definitionOf(name: string) {
  const [definition] = findLangWatchQLAppFunctions(name);
  if (!definition) throw new Error(`${name} left the catalog`);
  return definition;
}

describe("given an app-function call", () => {
  describe("when the argument count is wrong", () => {
    it("names the signature the function actually has", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("conversation_bounded"),
        args: [column],
      });

      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.message).toContain(
        "conversation_bounded(thread_key, max_tokens, until_trace_id)",
      );
    });

    it("points a three-argument eval at eval_criteria, which is the one that takes it", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("eval"),
        args: [column, text("The customer sounds annoyed"), list(["yes", "no"])],
      });

      expect(!outcome.ok && outcome.message).toContain(
        "eval_criteria(text, instructions, criteria)",
      );
    });
  });

  describe("when the options are literals of the declared shape", () => {
    it("reads them in declared order, leaving the key out", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("conversation_bounded"),
        args: [column, number(8_000), text("")],
      });

      expect(outcome).toEqual({ ok: true, options: [8_000, ""] });
    });

    it("keeps an empty until_trace_id, which means the whole thread", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("conversation_bounded"),
        args: [column, number(8_000), text("   ")],
      });

      expect(outcome.ok).toBe(true);
    });
  });

  describe("when an option is not a literal of that shape", () => {
    it("refuses an option read from a column rather than written in the query", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("conversation_bounded"),
        args: [column, column, text("")],
      });

      expect(!outcome.ok && outcome.message).toContain("written directly in the query");
    });

    it("refuses empty instructions, which would reach the judge as no question", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("eval"),
        args: [column, text("  ")],
      });

      expect(!outcome.ok && outcome.message).toContain("text, and not empty");
    });

    it("refuses a threshold outside the probability range", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("eval_passed"),
        args: [column, text("annoyed"), number(2)],
      });

      expect(!outcome.ok && outcome.message).toContain("between 0 and 1");
    });

    it("refuses a category option written without its gloss", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("eval_category"),
        args: [column, text("intent"), list(["refund", "bug"])],
      });

      expect(!outcome.ok && outcome.message).toContain("`name: what it means`");
    });

    it("accepts category options written as name and description", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("eval_category"),
        args: [column, text("intent"), list(["refund: wants money back", "bug: broken"])],
      });

      expect(outcome.ok).toBe(true);
    });
  });

  describe("when a score range is written", () => {
    it("accepts a scale that runs upwards inside the judge's level ceiling", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("eval_score"),
        args: [column, text("satisfaction"), number(1), number(5)],
      });

      expect(outcome).toEqual({ ok: true, options: ["satisfaction", 1, 5] });
    });

    it("refuses a scale that runs downwards", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("eval_score"),
        args: [column, text("satisfaction"), number(5), number(1)],
      });

      expect(!outcome.ok && outcome.message).toContain("must run upwards");
    });

    it("refuses a scale with more levels than the judge weighs", () => {
      const outcome = readAppFunctionArguments({
        definition: definitionOf("eval_score"),
        args: [column, text("satisfaction"), number(0), number(10)],
      });

      expect(!outcome.ok && outcome.message).toContain("at most 10 levels");
    });
  });
});
