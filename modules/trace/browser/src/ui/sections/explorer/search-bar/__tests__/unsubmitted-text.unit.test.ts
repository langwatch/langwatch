import { describe, expect, it } from "vitest";

import { isUnsubmittedText } from "../use-filter-editor.ts";

describe("isUnsubmittedText", () => {
  describe("given text the user typed and submitted", () => {
    /** @scenario "The inline hint shows only while typed text is unsubmitted" */
    it("reports nothing unsubmitted once Enter or the applied query covers it", () => {
      expect(
        isUnsubmittedText({ editorText: "foo bar baz", queryText: "", submittedText: null }),
      ).toBe(true);
      expect(
        isUnsubmittedText({
          editorText: "foo bar baz ",
          queryText: "",
          submittedText: "foo bar baz",
        }),
      ).toBe(false);
      expect(
        isUnsubmittedText({
          editorText: 'eval:"foo bar baz" ',
          queryText: 'eval:"foo bar baz"',
          submittedText: null,
        }),
      ).toBe(false);
      expect(
        isUnsubmittedText({
          editorText: 'eval:"foo bar baz" status:error',
          queryText: 'eval:"foo bar baz"',
          submittedText: null,
        }),
      ).toBe(true);
    });
  });

  describe("when the editor is empty", () => {
    it("reports nothing unsubmitted", () => {
      expect(isUnsubmittedText({ editorText: " ", queryText: "", submittedText: null })).toBe(
        false,
      );
    });
  });
});
