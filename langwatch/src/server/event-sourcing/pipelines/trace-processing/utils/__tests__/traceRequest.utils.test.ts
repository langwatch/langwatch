import { describe, expect, it } from "vitest";
import { TraceRequestUtils } from "../traceRequest.utils";

describe("traceRequest.utils", () => {
  describe("normalizeOtlpAttributes", () => {
    describe("when attributes contain flattened array patterns", () => {
      it("reconstructs consecutive indexed arrays into JSON strings", () => {
        const attributes = [
          {
            key: "llm.input_messages.0.message.content",
            value: { stringValue: "You are a helpful web agent." },
          },
          {
            key: "llm.input_messages.0.message.role",
            value: { stringValue: "system" },
          },
          {
            key: "llm.input_messages.1.message.content",
            value: { stringValue: "Tell me a joke" },
          },
          {
            key: "llm.input_messages.1.message.role",
            value: { stringValue: "user" },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("llm.input_messages");
        const parsed = JSON.parse(result["llm.input_messages"] as string);
        expect(parsed).toEqual([
          { message: { content: "You are a helpful web agent.", role: "system" } },
          { message: { content: "Tell me a joke", role: "user" } },
        ]);
      });

      it("handles single-item arrays", () => {
        const attributes = [
          {
            key: "messages.0.content",
            value: { stringValue: "Hello" },
          },
          {
            key: "messages.0.role",
            value: { stringValue: "user" },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("messages");
        const parsed = JSON.parse(result["messages"] as string);
        expect(parsed).toEqual([{ content: "Hello", role: "user" }]);
      });

      it("handles deeply nested structures", () => {
        const attributes = [
          {
            key: "data.0.a.b.c",
            value: { stringValue: "value1" },
          },
          {
            key: "data.0.a.b.d",
            value: { stringValue: "value2" },
          },
          {
            key: "data.1.a.b.c",
            value: { stringValue: "value3" },
          },
          {
            key: "data.1.a.b.d",
            value: { stringValue: "value4" },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("data");
        const parsed = JSON.parse(result["data"] as string);
        expect(parsed).toEqual([
          { a: { b: { c: "value1", d: "value2" } } },
          { a: { b: { c: "value3", d: "value4" } } },
        ]);
      });

      it("preserves non-array keys alongside reconstructed arrays", () => {
        const attributes = [
          {
            key: "llm.model",
            value: { stringValue: "gpt-4" },
          },
          {
            key: "llm.messages.0.content",
            value: { stringValue: "Hello" },
          },
          {
            key: "llm.messages.0.role",
            value: { stringValue: "user" },
          },
          {
            key: "other.key",
            value: { intValue: 42 },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result["llm.model"]).toBe("gpt-4");
        expect(result["other.key"]).toBe(42);
        expect(result).toHaveProperty("llm.messages");
        const parsed = JSON.parse(result["llm.messages"] as string);
        expect(parsed).toEqual([{ content: "Hello", role: "user" }]);
      });
    });

    describe("when arrays don't start at index 0", () => {
      it("keeps original flattened keys", () => {
        const attributes = [
          {
            key: "items.2.name",
            value: { stringValue: "item2" },
          },
          {
            key: "items.3.name",
            value: { stringValue: "item3" },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        // Should NOT be reconstructed - indices don't start at 0
        expect(result).not.toHaveProperty("items");
        expect(result["items.2.name"]).toBe("item2");
        expect(result["items.3.name"]).toBe("item3");
      });
    });

    describe("when arrays have non-consecutive indices", () => {
      it("keeps original flattened keys", () => {
        const attributes = [
          {
            key: "items.0.name",
            value: { stringValue: "item0" },
          },
          {
            key: "items.2.name",
            value: { stringValue: "item2" },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        // Should NOT be reconstructed - indices are not consecutive (missing 1)
        expect(result).not.toHaveProperty("items");
        expect(result["items.0.name"]).toBe("item0");
        expect(result["items.2.name"]).toBe("item2");
      });
    });

    describe("when array items have inconsistent shapes", () => {
      it("keeps original flattened keys", () => {
        const attributes = [
          {
            key: "items.0.name",
            value: { stringValue: "item0" },
          },
          {
            key: "items.0.value",
            value: { stringValue: "val0" },
          },
          {
            key: "items.1.name",
            value: { stringValue: "item1" },
          },
          // Note: items.1 is missing 'value' - inconsistent shape
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        // Should NOT be reconstructed - shapes are inconsistent
        expect(result).not.toHaveProperty("items");
        expect(result["items.0.name"]).toBe("item0");
        expect(result["items.0.value"]).toBe("val0");
        expect(result["items.1.name"]).toBe("item1");
      });
    });

    describe("when attributes are regular (no array patterns)", () => {
      it("returns them unchanged", () => {
        const attributes = [
          {
            key: "simple.key",
            value: { stringValue: "value" },
          },
          {
            key: "another.key",
            value: { intValue: 123 },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result["simple.key"]).toBe("value");
        expect(result["another.key"]).toBe(123);
      });
    });

    describe("when handling various value types in arrays", () => {
      it("preserves numeric values", () => {
        const attributes = [
          {
            key: "metrics.0.name",
            value: { stringValue: "latency" },
          },
          {
            key: "metrics.0.value",
            value: { doubleValue: 123.45 },
          },
          {
            key: "metrics.1.name",
            value: { stringValue: "count" },
          },
          {
            key: "metrics.1.value",
            value: { intValue: 42 },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("metrics");
        const parsed = JSON.parse(result["metrics"] as string);
        expect(parsed).toEqual([
          { name: "latency", value: 123.45 },
          { name: "count", value: 42 },
        ]);
      });

      it("preserves boolean true values", () => {
        // Note: The scalar() function in the original code has a limitation where
        // boolValue: false is not captured because it checks `v.boolValue` which is falsy.
        // This test only covers `true` values as a result.
        const attributes = [
          {
            key: "flags.0.name",
            value: { stringValue: "enabled" },
          },
          {
            key: "flags.0.active",
            value: { boolValue: true },
          },
          {
            key: "flags.1.name",
            value: { stringValue: "also_enabled" },
          },
          {
            key: "flags.1.active",
            value: { boolValue: true },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("flags");
        const parsed = JSON.parse(result["flags"] as string);
        expect(parsed).toEqual([
          { name: "enabled", active: true },
          { name: "also_enabled", active: true },
        ]);
      });
    });

    describe("when input is empty or null", () => {
      it("handles empty array", () => {
        const result = TraceRequestUtils.normalizeOtlpAttributes([]);
        expect(result).toEqual({});
      });

      it("handles null-ish input", () => {
        const result = TraceRequestUtils.normalizeOtlpAttributes(
          null as unknown as []
        );
        expect(result).toEqual({});
      });
    });

    describe("edge cases", () => {
      it("handles multiple separate arrays in same input", () => {
        const attributes = [
          {
            key: "input.0.text",
            value: { stringValue: "hello" },
          },
          {
            key: "input.1.text",
            value: { stringValue: "world" },
          },
          {
            key: "output.0.text",
            value: { stringValue: "foo" },
          },
          {
            key: "output.1.text",
            value: { stringValue: "bar" },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("input");
        expect(result).toHaveProperty("output");

        const parsedInput = JSON.parse(result["input"] as string);
        const parsedOutput = JSON.parse(result["output"] as string);

        expect(parsedInput).toEqual([{ text: "hello" }, { text: "world" }]);
        expect(parsedOutput).toEqual([{ text: "foo" }, { text: "bar" }]);
      });

      it("handles flat scalar value at array index (single field per item)", () => {
        const attributes = [
          {
            key: "tags.0.value",
            value: { stringValue: "tag1" },
          },
          {
            key: "tags.1.value",
            value: { stringValue: "tag2" },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("tags");
        const parsed = JSON.parse(result["tags"] as string);
        expect(parsed).toEqual([{ value: "tag1" }, { value: "tag2" }]);
      });
    });
  });
});
