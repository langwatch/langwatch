import { describe, it, expect } from "vitest";
import { parseRecordsJson } from "../records-add";

describe("parseRecordsJson()", () => {
  describe("when given a valid JSON array", () => {
    it("parses a single-element array", () => {
      const result = parseRecordsJson('[{"input": "hello", "output": "world"}]');
      expect(result).toEqual([{ input: "hello", output: "world" }]);
    });

    it("parses a multi-element array", () => {
      const result = parseRecordsJson(
        '[{"a": 1}, {"a": 2}, {"a": 3}]',
      );
      expect(result).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    });
  });

  describe("when given an empty array", () => {
    it("returns an empty array", () => {
      const result = parseRecordsJson("[]");
      expect(result).toEqual([]);
    });
  });

  describe("when given a non-array JSON value", () => {
    it("throws for a JSON object", () => {
      expect(() => parseRecordsJson('{"input": "hello"}')).toThrow(
        "expected a JSON array",
      );
    });

    it("throws for a JSON string", () => {
      expect(() => parseRecordsJson('"hello"')).toThrow(
        "expected a JSON array",
      );
    });

    it("throws for a JSON number", () => {
      expect(() => parseRecordsJson("42")).toThrow("expected a JSON array");
    });
  });

  describe("when given invalid JSON", () => {
    it("throws for malformed JSON", () => {
      expect(() => parseRecordsJson("{not valid json}")).toThrow(
        "Invalid JSON",
      );
    });

    it("throws for empty string", () => {
      expect(() => parseRecordsJson("")).toThrow("Invalid JSON");
    });
  });
});
