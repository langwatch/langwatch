import { describe, expect, it } from "vitest";

import { otlpAnyValueSchema, otlpKeyValueSchema } from "../any-value";

describe("otlpAnyValueSchema", () => {
  describe("given a value in each encoding a sender uses", () => {
    it.each([
      ["a string", { stringValue: "hello" }],
      ["a boolean", { boolValue: true }],
      ["a stringified boolean", { boolValue: "true" }],
      ["a number", { intValue: 7 }],
      ["a decimal string, which is how protobuf-JSON emits 64-bit integers", { intValue: "7" }],
      ["a structurally serialised Long", { intValue: { low: 7, high: 0 } }],
      ["a double", { doubleValue: 1.5 }],
      ["a stringified double", { doubleValue: "1.5" }],
      ["bytes", { bytesValue: new Uint8Array([1, 2]) }],
      ["base64 bytes", { bytesValue: "AQI=" }],
      ["a JSON-round-tripped Uint8Array", { bytesValue: { "0": 1, "1": 2 } }],
      ["an array", { arrayValue: { values: [{ stringValue: "a" }] } }],
      ["a kvlist", { kvlistValue: { values: [{ key: "k", value: { stringValue: "v" } }] } }],
    ])("accepts %s", (_label, value) => {
      expect(otlpAnyValueSchema.safeParse(value).success).toBe(true);
    });
  });

  describe("given the shapes protobuf-JSON produces for an absent field", () => {
    it("accepts an explicit null on every field", () => {
      const parsed = otlpAnyValueSchema.safeParse({
        stringValue: null,
        boolValue: null,
        intValue: null,
        doubleValue: null,
        bytesValue: null,
        arrayValue: null,
        kvlistValue: null,
      });

      expect(parsed.success).toBe(true);
    });

    it("accepts an empty value, which carries nothing at all", () => {
      expect(otlpAnyValueSchema.safeParse({}).success).toBe(true);
    });
  });

  /**
   * The spec makes AnyValue a `oneof`, so this payload is not conformant. The
   * ingestion path still has to accept it, because senders produce it — which
   * is why exclusivity is resolved when the value is READ rather than rejected
   * when it is parsed.
   */
  it("accepts a value that sets more than one field, rather than enforcing the oneof", () => {
    const parsed = otlpAnyValueSchema.safeParse({ stringValue: "", intValue: 3 });

    expect(parsed.success).toBe(true);
  });

  it("keeps a field a newer OTLP revision might add", () => {
    const parsed = otlpAnyValueSchema.parse({ stringValue: "x", futureValue: 1 });

    expect(parsed).toMatchObject({ stringValue: "x", futureValue: 1 });
  });

  describe("given a nested value", () => {
    it("recurses through an array of kvlists", () => {
      const parsed = otlpAnyValueSchema.safeParse({
        arrayValue: {
          values: [
            { kvlistValue: { values: [{ key: "a", value: { intValue: 1 } }] } },
            { kvlistValue: { values: [{ key: "b", value: { stringValue: "two" } }] } },
          ],
        },
      });

      expect(parsed.success).toBe(true);
    });
  });

  describe("given a value of the wrong type", () => {
    it.each([
      ["a number where a string belongs", { stringValue: 1 }],
      ["a boolean where an int belongs", { intValue: true }],
      ["a half-built Long", { intValue: { low: 1 } }],
      ["a non-numeric byte map", { bytesValue: { "0": "x" } }],
      ["an array that is not wrapped in values", { arrayValue: [{ stringValue: "a" }] }],
      ["a kvlist entry with no key", { kvlistValue: { values: [{ value: { intValue: 1 } }] } }],
    ])("rejects %s", (_label, value) => {
      expect(otlpAnyValueSchema.safeParse(value).success).toBe(false);
    });
  });
});

describe("otlpKeyValueSchema", () => {
  it("accepts a key and the value it carries", () => {
    const parsed = otlpKeyValueSchema.parse({ key: "service.name", value: { stringValue: "api" } });

    expect(parsed).toEqual({ key: "service.name", value: { stringValue: "api" } });
  });

  it.each([
    ["no key", { value: { stringValue: "api" } }],
    ["a non-string key", { key: 1, value: { stringValue: "api" } }],
    ["no value", { key: "service.name" }],
    ["a value that is not an AnyValue", { key: "service.name", value: "api" }],
  ])("rejects an entry with %s", (_label, entry) => {
    expect(otlpKeyValueSchema.safeParse(entry).success).toBe(false);
  });
});
