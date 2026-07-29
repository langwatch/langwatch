import { describe, expect, it } from "vitest";
import type { OtlpAnyValue } from "../../schemas/otlp";
import { TraceRequestUtils } from "../traceRequest.utils";

describe("traceRequest.utils", () => {
  describe("normalizeOtlpAttributes", () => {
    describe("when attributes contain flattened array patterns", () => {
      it("reconstructs consecutive indexed arrays into objects", () => {
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
        expect(result["llm.input_messages"]).toEqual([
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
        expect(result.messages).toEqual([{ content: "Hello", role: "user" }]);
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
        expect(result.data).toEqual([
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
        expect(result["llm.messages"]).toEqual([
          { content: "Hello", role: "user" },
        ]);
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
        expect(result.metrics).toEqual([
          { name: "latency", value: 123.45 },
          { name: "count", value: 69 },
        ]);
      });

      /** @scenario "Both settings of a flag survive a list of reported entries" */
      it("preserves boolean values in both directions", () => {
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
            value: { stringValue: "disabled" },
          },
          {
            key: "flags.1.active",
            value: { boolValue: false },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("flags");
        expect(result.flags).toEqual([
          { name: "enabled", active: true },
          { name: "disabled", active: false },
        ]);
      });

      /** @scenario "Zeros survive a list of reported entries rebuilt from its parts" */
      it("preserves numeric zeros", () => {
        const attributes = [
          {
            key: "usage.0.name",
            value: { stringValue: "output_tokens" },
          },
          {
            key: "usage.0.value",
            value: { intValue: 0 },
          },
          {
            key: "usage.1.name",
            value: { stringValue: "cost" },
          },
          {
            key: "usage.1.value",
            value: { doubleValue: 0 },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toHaveProperty("usage");
        expect(result.usage).toEqual([
          { name: "output_tokens", value: 0 },
          { name: "cost", value: 0 },
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
                values: [{ stringValue: "label1" }, { stringValue: "label2" }],
              },
            },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result["langwatch.labels"]).toEqual(["label1", "label2"]);
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

        expect(result["mixed.values"]).toEqual(["hello", 69, true]);
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

        expect(result.input).toEqual([{ text: "hello" }, { text: "world" }]);
        expect(result.output).toEqual([{ text: "foo" }, { text: "bar" }]);
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
        expect(result.tags).toEqual([{ value: "tag1" }, { value: "tag2" }]);
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

      it("flattens boolValue false", () => {
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

      it("returns empty object when scalar root has no rootKey", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue({
          stringValue: "orphan",
        });

        expect(result).toEqual({});
      });
    });

    describe("when the reported scalar is zero", () => {
      // Every branch of scalar() guards on presence, not truthiness. A
      // truthiness guard drops the key entirely, and a zero that never reaches
      // the span is indistinguishable downstream from one that was never
      // reported -- a zero token count, a zero cost, a zero retry count.

      /** @scenario "A whole numeric attribute of zero is recorded as zero" */
      it("records an intValue of 0 as zero", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { intValue: 0 },
          "count",
        );

        expect(result).toEqual({ count: 0 });
      });

      /** @scenario "A zero sent in text form is recorded as zero" */
      it("records an intValue of 0 in string form as zero", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { intValue: "0" },
          "count",
        );

        expect(result).toEqual({ count: 0 });
      });

      /** @scenario "A zero sent in the SDK's split 64-bit form is recorded as zero" */
      it("records an intValue of 0 in high/low form as zero", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { intValue: { high: 0, low: 0 } },
          "count",
        );

        expect(result).toEqual({ count: 0 });
      });

      /** @scenario "A fractional numeric attribute of zero is recorded as zero" */
      it("records a doubleValue of 0 as zero", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { doubleValue: 0 },
          "value",
        );

        expect(result).toEqual({ value: 0 });
      });

      it("records a doubleValue written as 0.0 as zero", () => {
        // 0.0 IS 0 in JavaScript, so spelling it as a float changes nothing.
        // Covered separately because the float zero is the shape that actually
        // arrives -- a zero cost, a zero temperature.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { doubleValue: 0.0 },
          "value",
        );

        expect(result).toEqual({ value: 0 });
      });

      it("records a doubleValue of 0 in string form as zero", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { doubleValue: "0.0" },
          "value",
        );

        expect(result).toEqual({ value: 0 });
      });

      /** @scenario "An attribute reported as false is recorded as false" */
      it("records a false boolValue rather than dropping it", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { boolValue: false },
          "cached",
        );

        expect(result).toEqual({ cached: false });
      });

      /** @scenario "A zero inside a reported list of numbers survives the list" */
      it("keeps a zero inside an arrayValue of scalars", () => {
        // scalar() maps array items through `scalar(item) ?? item`, so a
        // dropped zero used to leave the raw OTLP envelope in the array.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          {
            arrayValue: {
              values: [{ intValue: 0 }, { intValue: 1 }, { doubleValue: 0 }],
            },
          },
          "counts",
        );

        expect(result).toEqual({ counts: "[0,1,0]" });
      });
    });

    describe("when a numeric value is not parseable", () => {
      /** @scenario "A number that cannot be read stays absent rather than becoming zero" */
      it("drops an intValue that parses to NaN", () => {
        // NaN is not a value anyone reported: it serializes to null and reads
        // downstream as a corrupt number. Absent is the honest answer.
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { intValue: "not-a-number" },
          "count",
        );

        expect(result).toEqual({});
      });

      it("drops a doubleValue that parses to NaN", () => {
        const result = TraceRequestUtils.normalizeOtlpAnyValue(
          { doubleValue: "" },
          "value",
        );

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
      it("keeps the OTLP envelope rather than flattening to dot-paths", () => {
        // KNOWN LIMITATION, pinned so a change trips this test -- not a
        // contract worth preserving. `scalar()` intercepts arrayValue before
        // walk()'s array branch and maps each item through `scalar(item) ??
        // item`. For a kvlistValue item `scalar()` returns undefined, so the
        // fallback keeps the RAW OtlpAnyValue and the whole array is
        // JSON.stringified with the OTLP encoding still inside it.
        // Unwinding it changes the stored shape of every arrayValue-of-kvlist
        // attribute, so it is deliberately out of scope here; the zero-drop fix
        // does repair the scalar half of the same `?? item` fallback (see
        // "keeps a zero inside an arrayValue of scalars").
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
        const parsed = JSON.parse(result.messages as string);
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
        // BY DESIGN, and lossless: `isValidArrayPattern()` only rebuilds an
        // array when every item carries an identical remainder-key signature,
        // which is how it tells a genuine flattened array from unrelated dotted
        // keys that merely happen to contain a number. The cost is fidelity,
        // never data -- every reported key is still present and readable, just
        // flat. Loosening it is a judgement call about false positives, not a
        // correctness fix.
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
      it("keeps bare indexed keys flat", () => {
        // BY DESIGN, and lossless: INDEXED_KEY_REGEX = /^(.+?)\.(\d+)\.(.+)$/
        // requires a remainder segment after the index, so only object-shaped
        // items are candidates for reconstruction. A bare "items.0" is
        // indistinguishable from a legitimate dotted key that simply ends in a
        // number, so it is left exactly as reported.
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
      it("rebuilds an inner array as an object keyed by its index", () => {
        // KNOWN LIMITATION, pinned so a change trips this test -- not a
        // contract worth preserving. `unflattenObject()` always creates {} for
        // an intermediate segment, even when that segment is a numeric string
        // that is an array index, so an inner array comes back as an object and
        // a consumer iterating it finds nothing. No value is lost -- every leaf
        // is still reachable, under a "0" key instead of index 0.
        // The fix lives in the shared `safeUnflatten` util, used well beyond
        // this pipeline, so it is deliberately out of scope here.
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
        expect(result.choices).toEqual([
          {
            tool_calls: {
              "0": { name: "get_weather", args: '{"city":"NYC"}' },
            },
          },
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
        expect(result["llm.input_messages"]).toEqual([
          { message: { role: "system", content: "You are helpful." } },
          { message: { role: "user", content: "Summarize this." } },
          { message: { role: "assistant", content: "Sure, here is..." } },
        ]);
      });
    });

    describe("when receiving OpenAI function calling with tool_calls", () => {
      it("leaves an OpenAI tool-calling exchange as flat keys", () => {
        // The isValidArrayPattern conservatism above, on the shape that
        // actually arrives from an OpenAI SDK: item 0 carries tool_calls and
        // item 1 does not, so the key signatures differ and the message array
        // is not rebuilt. Lossless -- every message field is still present as
        // its own key, which is what the assertions below check.
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
        expect(result["llm.output_messages.0.message.tool_calls"]).toEqual([
          { function: { name: "search" } },
        ]);
        expect(result["llm.output_messages.1.message.role"]).toBe("tool");
        expect(result["llm.output_messages.1.message.content"]).toBe(
          "Result: 69",
        );
      });
    });

    describe("when an SDK reports a usage figure of zero", () => {
      /** @scenario "A usage report made entirely of zeros keeps every figure" */
      it("records the zero instead of omitting the attribute", () => {
        // The real casualties of a truthiness guard: a cached completion costs
        // nothing and emits no output tokens, and "0 output tokens" has to stay
        // distinguishable from "this SDK never reported output tokens".
        const attributes = [
          {
            key: "gen_ai.usage.output_tokens",
            value: { intValue: 0 },
          },
          {
            key: "gen_ai.usage.input_tokens",
            value: { intValue: 512 },
          },
          {
            key: "llm.usage.cost",
            value: { doubleValue: 0 },
          },
          {
            key: "gen_ai.request.temperature",
            value: { doubleValue: 0 },
          },
          {
            key: "llm.cache.hit",
            value: { boolValue: false },
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toEqual({
          "gen_ai.usage.output_tokens": 0,
          "gen_ai.usage.input_tokens": 512,
          "llm.usage.cost": 0,
          "gen_ai.request.temperature": 0,
          "llm.cache.hit": false,
        });
      });
    });

    describe("when an SDK reports empty bytes", () => {
      it("keeps the attribute as a present, empty value", () => {
        // Zero-length bytes is a reported value like any other: it survives as
        // the empty string rather than being dropped, so "sent nothing" stays
        // distinguishable from "sent no such attribute".
        const attributes = [
          {
            key: "payload.empty",
            value: { bytesValue: "" } as unknown as OtlpAnyValue,
          },
          {
            key: "payload.full",
            value: { bytesValue: "3q0=" } as unknown as OtlpAnyValue,
          },
        ];

        const result = TraceRequestUtils.normalizeOtlpAttributes(attributes);

        expect(result).toEqual({
          "payload.empty": "",
          "payload.full": "dead",
        });
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

        expect(result["langwatch.labels"]).toEqual([
          "production",
          "v2",
          "critical",
        ]);
      });
    });

    describe("when receiving OTLP arrayValue of objects (e.g. chat messages)", () => {
      it("stores raw OTLP kvlistValue structures for a chat-message array", () => {
        // KNOWN LIMITATION, pinned so a change trips this test -- the
        // scalar()-intercepts-arrayValue limitation above, on the shape that
        // actually arrives. Each kvlistValue item returns undefined from
        // scalar() and falls back to the raw OtlpAnyValue; the array is
        // JSON.stringified and then parsed straight back by
        // parseJsonStringValues, so the stored attribute is a list of OTLP
        // envelopes rather than a list of messages. Lossless but low-fidelity;
        // see the arrayValue-of-kvlist note above for why it is out of scope.
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

        // arrayValue of kvlistValue items: stored as array of raw OTLP structures
        expect(result["llm.messages"]).toEqual([
          {
            kvlistValue: {
              values: [
                { key: "role", value: { stringValue: "user" } },
                { key: "content", value: { stringValue: "Hello" } },
              ],
            },
          },
        ]);
      });
    });
  });
});
