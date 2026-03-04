import { describe, expect, it } from "vitest";
import { TraceRequestUtils } from "../traceRequest.utils";

const { reconstructFlattenedArrays } = TraceRequestUtils;

describe("reconstructFlattenedArrays", () => {
  describe("when given valid consecutive array patterns", () => {
    it("reconstructs a simple two-item array", () => {
      const result = reconstructFlattenedArrays({
        "items.0.name": "first",
        "items.0.value": 1,
        "items.1.name": "second",
        "items.1.value": 2,
      });

      expect(result.items).toEqual([
        { name: "first", value: 1 },
        { name: "second", value: 2 },
      ]);
    });

    it("reconstructs a single-item array", () => {
      const result = reconstructFlattenedArrays({
        "items.0.name": "only",
      });

      expect(result.items).toEqual([{ name: "only" }]);
    });

    it("reconstructs deeply nested remainder keys", () => {
      const result = reconstructFlattenedArrays({
        "msgs.0.message.content": "hello",
        "msgs.0.message.role": "user",
        "msgs.1.message.content": "hi",
        "msgs.1.message.role": "assistant",
      });

      expect(result.msgs).toEqual([
        { message: { content: "hello", role: "user" } },
        { message: { content: "hi", role: "assistant" } },
      ]);
    });
  });

  describe("when indices are non-consecutive", () => {
    it("preserves original flat keys", () => {
      const result = reconstructFlattenedArrays({
        "items.0.name": "first",
        "items.2.name": "third",
      });

      expect(result.items).toBeUndefined();
      expect(result["items.0.name"]).toBe("first");
      expect(result["items.2.name"]).toBe("third");
    });
  });

  describe("when indices do not start at 0", () => {
    it("preserves original flat keys", () => {
      const result = reconstructFlattenedArrays({
        "items.1.name": "second",
        "items.2.name": "third",
      });

      expect(result.items).toBeUndefined();
      expect(result["items.1.name"]).toBe("second");
      expect(result["items.2.name"]).toBe("third");
    });
  });

  describe("when array items have inconsistent shapes", () => {
    it("preserves original flat keys", () => {
      const result = reconstructFlattenedArrays({
        "items.0.name": "first",
        "items.0.extra": "bonus",
        "items.1.name": "second",
        // items.1 missing 'extra' — inconsistent shape
      });

      expect(result.items).toBeUndefined();
      expect(result["items.0.name"]).toBe("first");
      expect(result["items.0.extra"]).toBe("bonus");
      expect(result["items.1.name"]).toBe("second");
    });
  });

  describe("when mixed array and non-array keys coexist", () => {
    it("reconstructs arrays and preserves non-array keys", () => {
      const result = reconstructFlattenedArrays({
        "model": "gpt-4",
        "items.0.name": "first",
        "items.1.name": "second",
        "count": 42,
      });

      expect(result.model).toBe("gpt-4");
      expect(result.count).toBe(42);
      expect(result.items).toEqual([{ name: "first" }, { name: "second" }]);
    });
  });

  describe("when no array patterns exist", () => {
    it("returns attributes unchanged", () => {
      const input = {
        "simple.key": "value",
        "another.key": 123,
      };

      const result = reconstructFlattenedArrays(input);

      expect(result).toBe(input); // same reference — short-circuit
    });
  });

  describe("when given empty input", () => {
    it("returns the empty object", () => {
      const input = {};
      const result = reconstructFlattenedArrays(input);
      expect(result).toBe(input);
    });
  });

  describe("when keys have bare indices without remainder", () => {
    it("does not attempt reconstruction (regex requires remainder)", () => {
      const result = reconstructFlattenedArrays({
        "items.0": "first",
        "items.1": "second",
      });

      // No reconstruction because regex /^(.+?)\.(\d+)\.(.+)$/ requires remainder
      expect(result["items.0"]).toBe("first");
      expect(result["items.1"]).toBe("second");
    });
  });

  describe("when multiple separate arrays exist", () => {
    it("reconstructs each independently", () => {
      const result = reconstructFlattenedArrays({
        "input.0.text": "hello",
        "input.1.text": "world",
        "output.0.text": "foo",
        "output.1.text": "bar",
      });

      expect(result.input).toEqual([{ text: "hello" }, { text: "world" }]);
      expect(result.output).toEqual([{ text: "foo" }, { text: "bar" }]);
    });
  });

  describe("when values include various types", () => {
    it("preserves numeric, boolean, and string values", () => {
      const result = reconstructFlattenedArrays({
        "metrics.0.name": "latency",
        "metrics.0.value": 42.5,
        "metrics.0.enabled": true,
        "metrics.1.name": "count",
        "metrics.1.value": 100,
        "metrics.1.enabled": false,
      });

      expect(result.metrics).toEqual([
        { name: "latency", value: 42.5, enabled: true },
        { name: "count", value: 100, enabled: false },
      ]);
    });
  });
});
