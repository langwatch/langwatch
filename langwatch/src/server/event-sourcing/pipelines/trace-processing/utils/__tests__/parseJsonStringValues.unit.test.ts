import { describe, it, expect } from "vitest";
import { parseJsonStringValues } from "../traceRequest.utils";

describe("parseJsonStringValues", () => {
  describe("when given JSON object strings", () => {
    it("parses valid JSON objects", () => {
      const result = parseJsonStringValues({
        data: '{"key": "value"}',
      });
      expect(result.data).toEqual({ key: "value" });
    });
  });

  describe("when given JSON array strings", () => {
    it("parses valid JSON arrays", () => {
      const result = parseJsonStringValues({
        items: '[1, 2, 3]',
      });
      expect(result.items).toEqual([1, 2, 3]);
    });
  });

  describe("when given non-JSON strings", () => {
    it("passes plain strings through unchanged", () => {
      const result = parseJsonStringValues({
        text: "hello world",
      });
      expect(result.text).toBe("hello world");
    });

    it("passes strings that do not start with { or [", () => {
      const result = parseJsonStringValues({
        num: "42",
        bool: "true",
      });
      expect(result.num).toBe("42");
      expect(result.bool).toBe("true");
    });
  });

  describe("when given malformed JSON", () => {
    it("returns the original string", () => {
      const result = parseJsonStringValues({
        broken: '{"key": value}',
      });
      expect(result.broken).toBe('{"key": value}');
    });
  });

  describe("when given non-string values", () => {
    it("passes objects through unchanged", () => {
      const obj = { nested: true };
      const result = parseJsonStringValues({ data: obj });
      expect(result.data).toBe(obj);
    });

    it("passes numbers through unchanged", () => {
      const result = parseJsonStringValues({ count: 42 });
      expect(result.count).toBe(42);
    });
  });

  describe("when given oversized strings", () => {
    it("skips parsing strings exceeding the size limit", () => {
      const huge = "{" + "a".repeat(2_000_001) + "}";
      const result = parseJsonStringValues({ big: huge });
      expect(result.big).toBe(huge);
    });
  });

  describe("when given very short strings", () => {
    it("skips strings shorter than 2 characters", () => {
      const result = parseJsonStringValues({ tiny: "{" });
      expect(result.tiny).toBe("{");
    });
  });
});
