/**
 * @vitest-environment node
 * @unit
 * An errored run's error text as the trace list's evaluation summary carries it.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { describe, expect, it } from "vitest";

import {
  SUMMARY_ERROR_TEXT_MAX_CHARS,
  deriveSummaryErrorText,
} from "../evaluation-summary-error.rules.ts";

describe("deriveSummaryErrorText", () => {
  describe("given an errored run", () => {
    it("carries its error text without the surrounding whitespace", () => {
      expect(deriveSummaryErrorText({ status: "error", error: "  \n boom: spent \t " })).toBe(
        "boom: spent",
      );
    });

    it("carries no error text when none was stored or it is blank", () => {
      expect(deriveSummaryErrorText({ status: "error", error: null })).toBeUndefined();
      expect(deriveSummaryErrorText({ status: "error", error: " \n " })).toBeUndefined();
    });

    /** @scenario "A long error text is cut short in the summary" */
    it("cuts a long error text to its first characters followed by an ellipsis", () => {
      const head = "x".repeat(SUMMARY_ERROR_TEXT_MAX_CHARS);

      expect(SUMMARY_ERROR_TEXT_MAX_CHARS).toBe(300);
      expect(deriveSummaryErrorText({ status: "error", error: `${head}tail` })).toBe(`${head}…`);
      expect(deriveSummaryErrorText({ status: "error", error: head })).toBe(head);
    });
  });

  describe("given a run that did not error", () => {
    it("carries no error text, whatever was stored", () => {
      expect(deriveSummaryErrorText({ status: "processed", error: "stale" })).toBeUndefined();
      expect(deriveSummaryErrorText({ status: "skipped", error: "stale" })).toBeUndefined();
    });
  });
});
