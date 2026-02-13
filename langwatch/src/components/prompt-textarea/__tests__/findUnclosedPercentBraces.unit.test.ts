/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { findUnclosedPercentBraces } from "../utils";

describe("findUnclosedPercentBraces()", () => {
  describe("when text contains unclosed {%", () => {
    it("returns start position and empty query for bare {%", () => {
      const result = findUnclosedPercentBraces("Hello {%", 8);
      expect(result).toEqual({ start: 8, query: "" });
    });

    it("returns start position and trimmed query for {% with keyword", () => {
      const result = findUnclosedPercentBraces("Hello {% if", 11);
      expect(result).toEqual({ start: 8, query: "if" });
    });

    it("returns query with leading space trimmed", () => {
      const result = findUnclosedPercentBraces("Hello {%  fo", 12);
      expect(result).toEqual({ start: 8, query: "fo" });
    });

    it("returns result when {% is at the start of text", () => {
      const result = findUnclosedPercentBraces("{%", 2);
      expect(result).toEqual({ start: 2, query: "" });
    });

    it("returns result when {% is at start with keyword", () => {
      const result = findUnclosedPercentBraces("{% for", 6);
      expect(result).toEqual({ start: 2, query: "for" });
    });
  });

  describe("when text has no unclosed {%", () => {
    it("returns null for plain text", () => {
      const result = findUnclosedPercentBraces("Hello world", 11);
      expect(result).toBeNull();
    });

    it("returns null for single {", () => {
      const result = findUnclosedPercentBraces("Hello {", 7);
      expect(result).toBeNull();
    });

    it("returns null for completed {% %} tag", () => {
      const result = findUnclosedPercentBraces("{% if x %}", 10);
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      const result = findUnclosedPercentBraces("", 0);
      expect(result).toBeNull();
    });
  });

  describe("when {{% is typed (double brace then percent)", () => {
    it("returns null to avoid conflict with {{ variable syntax", () => {
      const result = findUnclosedPercentBraces("Hello {{%", 9);
      expect(result).toBeNull();
    });
  });

  describe("when cursor is not at the end", () => {
    it("only considers text before cursor position", () => {
      const result = findUnclosedPercentBraces("{% if %} more text", 5);
      expect(result).toEqual({ start: 2, query: "if" });
    });

    it("returns null when cursor is before {%", () => {
      const result = findUnclosedPercentBraces("Hello {% if", 3);
      expect(result).toBeNull();
    });
  });

  describe("when multiple {% exist in text", () => {
    it("returns the last unclosed {% before cursor", () => {
      const result = findUnclosedPercentBraces(
        "{% if x %}hello{% endif %} {%",
        29,
      );
      expect(result).toEqual({ start: 29, query: "" });
    });

    it("returns the last unclosed {% with query", () => {
      const text = "{% if x %}hello{% endif %} {% fo";
      const result = findUnclosedPercentBraces(text, text.length);
      expect(result).toEqual({ start: 29, query: "fo" });
    });
  });

  describe("when user has typed a keyword and is entering arguments", () => {
    it("returns null when query contains a space (e.g., 'if x')", () => {
      // After the keyword, a space means the user is typing arguments,
      // not searching for a construct. Don't show autocomplete.
      const result = findUnclosedPercentBraces("{% if x", 7);
      expect(result).toBeNull();
    });

    it("returns null for 'for i in' (typing loop arguments)", () => {
      const result = findUnclosedPercentBraces("{% for i in", 11);
      expect(result).toBeNull();
    });

    it("returns null for 'assign greeting' (typing assign target)", () => {
      const result = findUnclosedPercentBraces("{% assign greeting", 18);
      expect(result).toBeNull();
    });
  });
});
