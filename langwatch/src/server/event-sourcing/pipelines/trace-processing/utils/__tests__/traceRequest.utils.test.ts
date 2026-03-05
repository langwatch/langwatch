import { describe, expect, it } from "vitest";
import type { OtlpAnyValue } from "../../schemas/otlp";
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
          {
            message: {
              content: "You are a helpful web agent.",
              role: "system",
            },
          },
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
        const parsed = JSON.parse(result.messages as string);
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
        const parsed = JSON.parse(result.data as string);
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
            value: { intValue: 69 },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result["llm.model"]).toBe("gpt-4");
        expect(result["other.key"]).toBe(69);
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
            value: { intValue: 69 },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("metrics");
        const parsed = JSON.parse(result.metrics as string);
        expect(parsed).toEqual([
          { name: "latency", value: 123.45 },
          { name: "count", value: 69 },
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
        const parsed = JSON.parse(result.flags as string);
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
          null as unknown as [],
        );
        expect(result).toEqual({});
      });
    });

    describe("when attributes use OTEL arrayValue with AnyValue elements", () => {
      it("unwraps stringValue wrappers inside arrayValue", () => {
        const attributes = [
          {
            key: "langwatch.labels",
            value: {
              arrayValue: {
                values: [
                  { stringValue: "label1" },
                  { stringValue: "label2" },
                ],
              },
            },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result["langwatch.labels"]).toBe('["label1","label2"]');
        const parsed = JSON.parse(result["langwatch.labels"] as string);
        expect(parsed).toEqual(["label1", "label2"]);
      });

      it("unwraps mixed scalar types inside arrayValue", () => {
        const attributes = [
          {
            key: "mixed.values",
            value: {
              arrayValue: {
                values: [
                  { stringValue: "hello" },
                  { intValue: 69 },
                  { boolValue: true },
                ],
              },
            },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        const parsed = JSON.parse(result["mixed.values"] as string);
        expect(parsed).toEqual(["hello", 69, true]);
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

        const parsedInput = JSON.parse(result.input as string);
        const parsedOutput = JSON.parse(result.output as string);

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
        const parsed = JSON.parse(result.tags as string);
        expect(parsed).toEqual([{ value: "tag1" }, { value: "tag2" }]);
      });
    });
  });

  describe("normalizeOtlpAnyValue", () => {
    describe("when value is a scalar", () => {
      it("flattens stringValue with rootKey", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { stringValue: "hello" },
          "my.key",
        );

        expect(result).toEqual({ "my.key": "hello" });
      });

      it("flattens intValue as number", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { intValue: 69 },
          "count",
        );

        expect(result).toEqual({ count: 69 });
      });

      it("flattens intValue from string form", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { intValue: "999" },
          "count",
        );

        expect(result).toEqual({ count: 999 });
      });

      it("flattens intValue from high/low bigint form", () => {
        // high=0, low=100 => BigInt(0) << 32n | BigInt(100) = 100
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { intValue: { high: 0, low: 100 } },
          "ts",
        );

        expect(result).toEqual({ ts: 100 });
      });

      it("flattens doubleValue", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { doubleValue: 3.14 },
          "pi",
        );

        expect(result).toEqual({ pi: 3.14 });
      });

      it("flattens doubleValue from string form", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { doubleValue: "2.718" },
          "e",
        );

        expect(result).toEqual({ e: 2.718 });
      });

      it("flattens boolValue true", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { boolValue: true },
          "flag",
        );

        expect(result).toEqual({ flag: true });
      });

      it("preserves boolValue false via !== null check", () => {
        // NOTE: The boolValue check uses `v.boolValue !== null` (not a truthy
        // check), so false IS correctly returned -- unlike intValue/doubleValue.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { boolValue: false },
          "flag",
        );

        expect(result).toEqual({ flag: false });
      });

      it("coerces boolValue string 'true' to boolean", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { boolValue: "true" } as OtlpAnyValue,
          "flag",
        );

        expect(result).toEqual({ flag: true });
      });

      it("coerces boolValue string 'false' to boolean false", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { boolValue: "false" } as OtlpAnyValue,
          "flag",
        );

        expect(result).toEqual({ flag: false });
      });

      it("drops intValue 0 due to falsy check", () => {
        // BUG: scalar() checks `v.intValue` which is falsy for 0,
        // so intValue: 0 is never captured and returns undefined.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { intValue: 0 },
          "count",
        );

        expect(result).toEqual({});
      });

      it("drops doubleValue 0 due to falsy check", () => {
        // BUG: scalar() checks `v.doubleValue` which is falsy for 0,
        // so doubleValue: 0 is never captured and returns undefined.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { doubleValue: 0 },
          "value",
        );

        expect(result).toEqual({});
      });

      it("drops doubleValue 0.0 due to falsy check", () => {
        // BUG: 0.0 === 0 in JavaScript, still falsy.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { doubleValue: 0.0 },
          "value",
        );

        expect(result).toEqual({});
      });

      it("returns empty object when scalar root has no rootKey", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue({
          stringValue: "orphan",
        });

        expect(result).toEqual({});
      });
    });

    describe("when value is a kvlistValue", () => {
      it("flattens single-level kvlist to dot-separated keys", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          {
            kvlistValue: {
              values: [
                { key: "name", value: { stringValue: "Alice" } },
                { key: "age", value: { intValue: 30 } },
              ],
            },
          },
          "user",
        );

        expect(result).toEqual({ "user.name": "Alice", "user.age": 30 });
      });

      it("flattens multi-level nested kvlist", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          {
            kvlistValue: {
              values: [
                {
                  key: "address",
                  value: {
                    kvlistValue: {
                      values: [
                        { key: "city", value: { stringValue: "NYC" } },
                        { key: "zip", value: { stringValue: "10001" } },
                      ],
                    },
                  },
                },
              ],
            },
          },
          "user",
        );

        expect(result).toEqual({
          "user.address.city": "NYC",
          "user.address.zip": "10001",
        });
      });

      it("handles empty kvlist", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { kvlistValue: { values: [] } },
          "meta",
        );

        expect(result).toEqual({});
      });

      it("uses rootKey as prefix for kvlist keys", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          {
            kvlistValue: {
              values: [{ key: "x", value: { stringValue: "1" } }],
            },
          },
          "prefix",
        );

        expect(result).toEqual({ "prefix.x": "1" });
      });

      it("flattens kvlist without rootKey using bare keys", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue({
          kvlistValue: {
            values: [
              { key: "a", value: { stringValue: "1" } },
              { key: "b", value: { stringValue: "2" } },
            ],
          },
        });

        expect(result).toEqual({ a: "1", b: "2" });
      });
    });

    describe("when value is an arrayValue of scalars", () => {
      it("JSON.stringifies scalar string arrays via scalar()", () => {
        // NOTE: scalar() intercepts arrayValue before walk() can handle it.
        // The result is a JSON string stored under the rootKey, not a native array.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          {
            arrayValue: {
              values: [
                { stringValue: "a" },
                { stringValue: "b" },
                { stringValue: "c" },
              ],
            },
          },
          "tags",
        );

        expect(result).toEqual({ tags: '["a","b","c"]' });
      });

      it("JSON.stringifies mixed scalar arrays via scalar()", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          {
            arrayValue: {
              values: [
                { stringValue: "hello" },
                { intValue: 69 },
                { boolValue: true },
              ],
            },
          },
          "mixed",
        );

        expect(result).toEqual({ mixed: '["hello",69,true]' });
      });
    });

    describe("when value is an arrayValue of objects (kvlistValue items)", () => {
      it("JSON.stringifies instead of flattening to dot-paths", () => {
        // BUG: scalar() intercepts arrayValue before walk()'s array branch.
        // scalar() calls itself recursively on each item. For kvlistValue items,
        // scalar() returns undefined, so the fallback `?? item` returns the raw
        // OtlpAnyValue object. The whole array is then JSON.stringified.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          {
            arrayValue: {
              values: [
                {
                  kvlistValue: {
                    values: [
                      { key: "role", value: { stringValue: "user" } },
                      { key: "content", value: { stringValue: "Hi" } },
                    ],
                  },
                },
                {
                  kvlistValue: {
                    values: [
                      { key: "role", value: { stringValue: "assistant" } },
                      { key: "content", value: { stringValue: "Hello!" } },
                    ],
                  },
                },
              ],
            },
          },
          "messages",
        );

        // The result is a JSON string containing the raw OTLP kvlistValue structures,
        // NOT the flattened key-value pairs one might expect.
        const parsed = JSON.parse(result["messages"] as string);
        expect(parsed).toHaveLength(2);
        // Each item is the raw OtlpAnyValue because scalar() returns undefined for kvlist
        expect(parsed[0]).toHaveProperty("kvlistValue");
        expect(parsed[1]).toHaveProperty("kvlistValue");
      });
    });

    describe("when value has nested arrays inside kvlistValue", () => {
      it("JSON.stringifies inner array values", () => {
        // When a kvlist has a key whose value is an arrayValue,
        // walk() recurses into the kvlist keys, then hits the array value.
        // scalar() catches the arrayValue and JSON.stringifies it.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          {
            kvlistValue: {
              values: [
                { key: "name", value: { stringValue: "test" } },
                {
                  key: "tags",
                  value: {
                    arrayValue: {
                      values: [
                        { stringValue: "alpha" },
                        { stringValue: "beta" },
                      ],
                    },
                  },
                },
              ],
            },
          },
          "item",
        );

        expect(result["item.name"]).toBe("test");
        expect(result["item.tags"]).toBe('["alpha","beta"]');
      });
    });
  });

  describe("reconstructFlattenedArrays", () => {
    // These test the reconstruction by feeding pre-flattened keys through normalizeOtlpAttributes

    describe("when items have heterogeneous shapes", () => {
      it("keeps flat keys when array items have different key sets", () => {
        // BUG: isValidArrayPattern() requires all items to have identical key
        // signatures (same set of remainder keys). Real-world data like OpenAI
        // messages often have varying shapes (some messages have tool_calls, some don't).
        const attributes = [
          {
            key: "messages.0.role",
            value: { stringValue: "user" },
          },
          {
            key: "messages.0.content",
            value: { stringValue: "Hi" },
          },
          {
            key: "messages.1.role",
            value: { stringValue: "assistant" },
          },
          {
            key: "messages.1.content",
            value: { stringValue: "Hello" },
          },
          {
            key: "messages.1.tool_calls",
            value: { stringValue: "[...]" },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        // NOT reconstructed because item 0 has {role, content} and item 1 has
        // {role, content, tool_calls} -- different key signatures.
        expect(result).not.toHaveProperty("messages");
        expect(result["messages.0.role"]).toBe("user");
        expect(result["messages.0.content"]).toBe("Hi");
        expect(result["messages.1.role"]).toBe("assistant");
        expect(result["messages.1.content"]).toBe("Hello");
        expect(result["messages.1.tool_calls"]).toBe("[...]");
      });
    });

    describe("when keys are bare indexed (prefix.N with no remainder)", () => {
      it("passes through unchanged because regex requires remainder", () => {
        // BUG: INDEXED_KEY_REGEX = /^(.+?)\.(\d+)\.(.+)$/ requires a remainder
        // segment after the index. Keys like "items.0" never match, so they are
        // never considered for array reconstruction.
        const attributes = [
          {
            key: "items.0",
            value: { stringValue: "first" },
          },
          {
            key: "items.1",
            value: { stringValue: "second" },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        // These keys pass through unchanged -- no reconstruction
        expect(result).not.toHaveProperty("items");
        expect(result["items.0"]).toBe("first");
        expect(result["items.1"]).toBe("second");
      });
    });

    describe("when remainder contains numeric segments", () => {
      it("creates objects with string-number keys for inner arrays", () => {
        // BUG: unflattenObject() always creates {} for intermediate segments,
        // even when the key is a numeric string that should be an array index.
        // e.g. "choices.0.tool_calls.0.name" produces
        //   tool_calls: { "0": { "name": ... } } instead of tool_calls: [{ name: ... }]
        const attributes = [
          {
            key: "choices.0.tool_calls.0.name",
            value: { stringValue: "get_weather" },
          },
          {
            key: "choices.0.tool_calls.0.args",
            value: { stringValue: '{"city":"NYC"}' },
          },
          {
            key: "choices.1.tool_calls.0.name",
            value: { stringValue: "get_time" },
          },
          {
            key: "choices.1.tool_calls.0.args",
            value: { stringValue: '{"tz":"EST"}' },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        // The regex /^(.+?)\.(\d+)\.(.+)$/ captures "choices" as prefix,
        // "0" / "1" as index, and "tool_calls.0.name" / "tool_calls.0.args" as remainder.
        // unflattenObject then splits the remainder by "." and creates nested objects.
        expect(result).toHaveProperty("choices");
        const parsed = JSON.parse(result["choices"] as string);
        expect(parsed).toEqual([
          { tool_calls: { "0": { name: "get_weather", args: '{"city":"NYC"}' } } },
          { tool_calls: { "0": { name: "get_time", args: '{"tz":"EST"}' } } },
        ]);
      });
    });
  });

  describe("normalizeOtlpAttributes -- real-world SDK patterns", () => {
    describe("when receiving Traceloop/OpenLLMetry llm.input_messages", () => {
      it("reconstructs homogeneous message arrays into JSON", () => {
        // These come as pre-flattened keys from the Traceloop SDK
        const attributes = [
          {
            key: "llm.input_messages.0.message.role",
            value: { stringValue: "system" },
          },
          {
            key: "llm.input_messages.0.message.content",
            value: { stringValue: "You are helpful." },
          },
          {
            key: "llm.input_messages.1.message.role",
            value: { stringValue: "user" },
          },
          {
            key: "llm.input_messages.1.message.content",
            value: { stringValue: "Summarize this." },
          },
          {
            key: "llm.input_messages.2.message.role",
            value: { stringValue: "assistant" },
          },
          {
            key: "llm.input_messages.2.message.content",
            value: { stringValue: "Sure, here is..." },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("llm.input_messages");
        const parsed = JSON.parse(result["llm.input_messages"] as string);
        expect(parsed).toEqual([
          { message: { role: "system", content: "You are helpful." } },
          { message: { role: "user", content: "Summarize this." } },
          { message: { role: "assistant", content: "Sure, here is..." } },
        ]);
      });
    });

    describe("when receiving OpenAI function calling with tool_calls", () => {
      it("keeps flat keys due to heterogeneous shape rejection", () => {
        // BUG: Messages with varying shapes (some have tool_calls, some don't)
        // are rejected by isValidArrayPattern because key signatures differ.
        const attributes = [
          {
            key: "llm.output_messages.0.message.role",
            value: { stringValue: "assistant" },
          },
          {
            key: "llm.output_messages.0.message.content",
            value: { stringValue: "Let me check." },
          },
          {
            key: "llm.output_messages.0.message.tool_calls",
            value: { stringValue: '[{"function":{"name":"search"}}]' },
          },
          {
            key: "llm.output_messages.1.message.role",
            value: { stringValue: "tool" },
          },
          {
            key: "llm.output_messages.1.message.content",
            value: { stringValue: "Result: 69" },
          },
          // Note: item 1 has no tool_calls -- heterogeneous shapes
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        // NOT reconstructed due to heterogeneous key signatures
        expect(result).not.toHaveProperty("llm.output_messages");
        expect(result["llm.output_messages.0.message.role"]).toBe("assistant");
        expect(result["llm.output_messages.0.message.content"]).toBe(
          "Let me check.",
        );
        expect(result["llm.output_messages.0.message.tool_calls"]).toBe(
          '[{"function":{"name":"search"}}]',
        );
        expect(result["llm.output_messages.1.message.role"]).toBe("tool");
        expect(result["llm.output_messages.1.message.content"]).toBe(
          "Result: 69",
        );
      });
    });

    describe("when receiving nested OTLP kvlistValue (e.g. metadata)", () => {
      it("flattens to dot-separated keys", () => {
        // Deeply nested object sent as kvlistValue, not pre-flattened
        const attributes = [
          {
            key: "gen_ai.metadata",
            value: {
              kvlistValue: {
                values: [
                  { key: "model", value: { stringValue: "gpt-4" } },
                  {
                    key: "params",
                    value: {
                      kvlistValue: {
                        values: [
                          { key: "temperature", value: { doubleValue: 0.7 } },
                          { key: "max_tokens", value: { intValue: 1024 } },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result["gen_ai.metadata.model"]).toBe("gpt-4");
        expect(result["gen_ai.metadata.params.temperature"]).toBe(0.7);
        expect(result["gen_ai.metadata.params.max_tokens"]).toBe(1024);
      });
    });

    describe("when receiving OTLP arrayValue of strings (e.g. labels)", () => {
      it("stores as JSON string", () => {
        const attributes = [
          {
            key: "langwatch.labels",
            value: {
              arrayValue: {
                values: [
                  { stringValue: "production" },
                  { stringValue: "v2" },
                  { stringValue: "critical" },
                ],
              },
            },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result["langwatch.labels"]).toBe(
          '["production","v2","critical"]',
        );
      });
    });

    describe("when receiving OTLP arrayValue of objects (e.g. chat messages)", () => {
      it("stores entire array as JSON string via scalar()", () => {
        // BUG: scalar() intercepts the arrayValue before walk()'s array branch.
        // Each kvlistValue item returns undefined from scalar(), falling back to
        // the raw OtlpAnyValue object. The entire thing is JSON.stringified.
        const attributes = [
          {
            key: "llm.messages",
            value: {
              arrayValue: {
                values: [
                  {
                    kvlistValue: {
                      values: [
                        { key: "role", value: { stringValue: "user" } },
                        {
                          key: "content",
                          value: { stringValue: "Hello" },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        // The value is a JSON string containing the raw kvlistValue structure
        const parsed = JSON.parse(result["llm.messages"] as string);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toHaveProperty("kvlistValue");
        expect(parsed[0].kvlistValue.values).toHaveLength(2);
      });
    });
  });
});
