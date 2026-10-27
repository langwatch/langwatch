/**
 * The dropdown state for the traces search bar: everything between a pair of
 * quotes is one value, and U+00A0 ends a token as an ordinary space does.
 */
import { describe, expect, it } from "vitest";

import { isInsideQuotedValue, searchBarSuggestionState } from "../search-bar-suggestion-state.ts";

describe("given the caret sits inside a quoted value", () => {
  describe("when a word of the value is being typed", () => {
    /** @scenario "A space belongs to the question being typed" */
    it("returns closed, because everything inside the quotes is one value", () => {
      expect(searchBarSuggestionState('@status:"refund po', 18)).toEqual({ open: false });
    });

    /** @scenario "A space belongs to the question being typed" */
    it("reads a question of several words as one value", () => {
      expect(searchBarSuggestionState('eval:"is the user', 17)).toEqual({ open: false });
      expect(isInsideQuotedValue('eval:"is the user', 17)).toBe(true);
    });

    it("leaves an escaped quote inside the value", () => {
      expect(isInsideQuotedValue('eval:"they said \\"no', 20)).toBe(true);
    });
  });

  describe("when the caret is past the closing quote", () => {
    it("opens field mode again, because the value ended", () => {
      expect(searchBarSuggestionState('status:"refund policy" mo', 25)).toEqual({
        open: true,
        mode: "field",
        query: "mo",
        tokenStart: 23,
      });
    });
  });
});

describe("given the clauses are separated by a non-breaking space", () => {
  describe("when a second field name is being typed", () => {
    /** @scenario "The field list opens for every clause, not only the first" */
    it("opens field mode on it, because U+00A0 ends a token as a space does", () => {
      expect(searchBarSuggestionState("status:error ser", 16)).toEqual({
        open: true,
        mode: "field",
        query: "ser",
        tokenStart: 13,
      });
    });

    /** @scenario "The field list opens for every clause, not only the first" */
    it("opens value mode on the second clause's own value", () => {
      expect(searchBarSuggestionState("status:error service:ap", 24)).toEqual({
        open: true,
        mode: "value",
        field: "service",
        query: "ap",
        tokenStart: 13,
      });
    });
  });
});
