/**
 * Which typed `and` / `or` / `not` the search bar turns into an operator.
 * Spec: specs/traces-v2/search.feature
 */
import { describe, expect, it } from "vitest";

import { operatorEdit } from "../operator-autocase.ts";

/** The edit made by typing a space after `text`. */
const typeSpaceAfter = (text: string) => operatorEdit({ oldText: text, newText: `${text} ` });

describe("operatorEdit", () => {
  describe("given a lowercase not typed after a word of a sentence", () => {
    /** @scenario "The editor uppercases an operator only where it joins filter terms" */
    it("leaves it a word", () => {
      expect(typeSpaceAfter("where did a member ask about cover that is not")).toBeNull();
    });

    it.each(["refunds and", "refunds or", "why is this not", "the members' and"])(
      "leaves %j alone",
      (text) => {
        expect(typeSpaceAfter(text)).toBeNull();
      },
    );
  });

  describe("given an operator typed after a filter term", () => {
    it.each([
      ["status:error and", "and"],
      ["status:error or", "or"],
      ['"refund policy" and', "and"],
      ["(status:error OR status:ok) and", "and"],
      ["model:'gpt 5' or", "or"],
      ["-timeout and", "and"],
    ])("uppercases %j", (text, word) => {
      expect(typeSpaceAfter(text)).toEqual({
        word,
        from: text.length - word.length,
        to: text.length,
      });
    });
  });

  describe("given not where it opens a clause", () => {
    it.each(["not", "status:error AND not", "(not", "status:error not"])(
      "uppercases %j",
      (text) => {
        expect(typeSpaceAfter(text)).toEqual({
          word: "not",
          from: text.length - 3,
          to: text.length,
        });
      },
    );

    it("leaves and / or alone at the start", () => {
      expect(typeSpaceAfter("and")).toBeNull();
    });
  });

  describe("given the word sits inside a quoted phrase or a range", () => {
    it.each(['status:error "this is not', "tokens:[10 and"])("leaves %j alone", (text) => {
      expect(typeSpaceAfter(text)).toBeNull();
    });
  });

  describe("given a paste rather than one separator", () => {
    it("leaves it alone", () => {
      expect(
        operatorEdit({ oldText: "status:error", newText: "status:error and more" }),
      ).toBeNull();
    });
  });
});
