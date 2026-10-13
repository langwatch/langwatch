/**
 * Which typed `and` / `or` / `not` the search bar turns into an operator.
 * Spec: specs/traces-v2/search.feature
 */
import { describe, expect, it } from "vitest";

import { operatorEdit } from "../operator-autocase.ts";

const typeSpaceAfter = (text: string) => operatorEdit({ oldText: text, newText: `${text} ` });

const uppercased = ({ text, word }: { text: string; word: string }) => ({
  word,
  from: text.length - word.length,
  to: text.length,
});

describe("operatorEdit", () => {
  describe("given a lowercase not after a word of a sentence", () => {
    describe("when a space is typed after it", () => {
      /** @scenario "The editor uppercases an operator only where it joins filter terms" */
      it("leaves it a word", () => {
        expect(typeSpaceAfter("where did a member ask about cover that is not")).toBeNull();
      });

      it.each([
        "refunds and",
        "refunds or",
        "why is this not",
        "the members' and",
        "meet at 12:30 and",
      ])("leaves %j alone", (text) => {
        expect(typeSpaceAfter(text)).toBeNull();
      });
    });
  });

  describe("given an operator after a filter term", () => {
    describe("when a space is typed after it", () => {
      it.each([
        ["status:error and", "and"],
        ["status:error or", "or"],
        ['"refund policy" and', "and"],
        ["(status:error OR status:ok) and", "and"],
        ["model:'gpt 5' or", "or"],
        ["-timeout and", "and"],
        ["metadata.user_id:42 and", "and"],
      ])("uppercases %j", (text, word) => {
        expect(typeSpaceAfter(text)).toEqual(uppercased({ text, word }));
      });
    });
  });

  describe("given not where it opens a clause", () => {
    describe("when a space is typed after it", () => {
      it.each(["not", "status:error AND not", "(not", "status:error not"])(
        "uppercases %j",
        (text) => {
          expect(typeSpaceAfter(text)).toEqual(uppercased({ text, word: "not" }));
        },
      );
    });
  });

  describe("given and at the start", () => {
    describe("when a space is typed after it", () => {
      it("leaves it alone", () => {
        expect(typeSpaceAfter("and")).toBeNull();
      });
    });
  });

  describe("given the word sits inside a quoted phrase or a range", () => {
    describe("when a space is typed after it", () => {
      it.each(['status:error "this is not', "tokens:[10 and"])("leaves %j alone", (text) => {
        expect(typeSpaceAfter(text)).toBeNull();
      });
    });
  });

  describe("given a filter term", () => {
    describe("when more than one character is pasted", () => {
      it("leaves it alone", () => {
        expect(
          operatorEdit({ oldText: "status:error", newText: "status:error and more" }),
        ).toBeNull();
      });
    });
  });
});
