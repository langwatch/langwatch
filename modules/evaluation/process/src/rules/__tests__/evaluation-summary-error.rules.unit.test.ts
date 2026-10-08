import { describe, expect, it } from "vitest";

import {
  SUMMARY_ERROR_TEXT_MAX_CHARS,
  summaryErrorTextOf,
} from "../evaluation-summary-error.rules.ts";

describe("summaryErrorTextOf", () => {
  describe("given an errored run", () => {
    it("carries its error text without the surrounding whitespace", () => {
      expect(summaryErrorTextOf({ status: "error", error: "  \n boom: spent \t " })).toBe(
        "boom: spent",
      );
    });

    it("carries no error text when none was stored or it is blank", () => {
      expect(summaryErrorTextOf({ status: "error", error: null })).toBeNull();
      expect(summaryErrorTextOf({ status: "error", error: " \n " })).toBeNull();
    });

    /** @scenario "A long error text is cut short in the summary" */
    it("cuts a long error text to its first characters followed by an ellipsis", () => {
      const head = "x".repeat(SUMMARY_ERROR_TEXT_MAX_CHARS);

      expect(SUMMARY_ERROR_TEXT_MAX_CHARS).toBe(300);
      expect(summaryErrorTextOf({ status: "error", error: `${head}tail` })).toBe(`${head}…`);
      expect(summaryErrorTextOf({ status: "error", error: head })).toBe(head);
    });
  });

  describe("given a run that did not error", () => {
    it("carries no error text, whatever was stored", () => {
      expect(summaryErrorTextOf({ status: "processed", error: "stale" })).toBeNull();
      expect(summaryErrorTextOf({ status: "skipped", error: "stale" })).toBeNull();
    });
  });
});
