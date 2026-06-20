import { describe, expect, it } from "vitest";
import { SEARCH_FIELDS } from "~/server/app-layer/traces/query-language/metadata";
import {
  getFieldSuggestions,
  getValueSuggestions,
} from "../suggestionItems";

describe("getFieldSuggestions", () => {
  describe("given a blank query", () => {
    describe("when called", () => {
      it("returns every static field with its human label and raw field", () => {
        const items = getFieldSuggestions("");
        const status = items.find((i) => i.value === "status");
        expect(status).toBeDefined();
        // The dropdown renders the human label as the primary text and the
        // raw field as a mono hint — both must be carried on the item.
        expect(status?.label).toBe(SEARCH_FIELDS.status?.label);
        expect(status?.field).toBe("status");
      });
    });
  });

  describe("given a query that matches the raw field id but not the label", () => {
    describe("when called", () => {
      it("still surfaces the field (matches against the raw field too)", () => {
        // Label is "Tokens / second"; the raw field is "tokensPerSecond".
        // Typing the raw id must find it even though the label has no
        // "persecond" substring.
        const items = getFieldSuggestions("tokenspersecond");
        expect(items.some((i) => i.value === "tokensPerSecond")).toBe(true);
      });
    });
  });

  describe("given a query that matches the human label", () => {
    describe("when called", () => {
      it("surfaces the field by its label", () => {
        // "duration" field has label "Duration"; typing "durat" hits the
        // label prefix.
        const items = getFieldSuggestions("durat");
        expect(items.some((i) => i.value === "duration")).toBe(true);
      });
    });
  });

  describe("given a prefix query", () => {
    describe("when a label prefix-matches and another only contains", () => {
      it("ranks the prefix match ahead of the contains match", () => {
        // "Status" (label starts with "stat") should rank before any field
        // whose label merely contains "stat".
        const items = getFieldSuggestions("stat");
        const statusIdx = items.findIndex((i) => i.value === "status");
        expect(statusIdx).toBeGreaterThanOrEqual(0);
        // No earlier item should be a mere contains-match when status is an
        // exact prefix — status must be at the front of the matched set.
        expect(statusIdx).toBe(0);
      });
    });
  });
});

describe("getValueSuggestions", () => {
  describe("given a field with known static values", () => {
    describe("when called with a blank query", () => {
      it("returns the field's values", () => {
        const values = getValueSuggestions("status", "");
        expect(values.length).toBeGreaterThan(0);
      });
    });
  });
});
