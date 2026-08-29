import { describe, expect, it } from "vitest";

import { normalizeOtlpAttributeMap, otlpScalarValue } from "../attribute-map";

describe("otlpScalarValue", () => {
  describe("given each scalar encoding", () => {
    it("reads a string", () => {
      expect(otlpScalarValue({ stringValue: "hello" })).toBe("hello");
    });

    it("reads the empty string, which is a value rather than an absence", () => {
      expect(otlpScalarValue({ stringValue: "" })).toBe("");
    });

    it("reads a boolean", () => {
      expect(otlpScalarValue({ boolValue: false })).toBe(false);
    });

    it.each([
      ["true", true],
      ["TRUE", true],
      ["True", true],
      ["false", false],
      ["anything else", false],
    ])("reads the stringified boolean %s as %s", (input, expected) => {
      expect(otlpScalarValue({ boolValue: input })).toBe(expected);
    });

    it("reads a numeric int", () => {
      expect(otlpScalarValue({ intValue: 42 })).toBe(42);
    });

    it("reads the decimal string protobuf-JSON emits for a 64-bit integer", () => {
      expect(otlpScalarValue({ intValue: "42" })).toBe(42);
    });

    it("reads a double", () => {
      expect(otlpScalarValue({ doubleValue: 1.5 })).toBe(1.5);
    });

    it("reads a stringified double", () => {
      expect(otlpScalarValue({ doubleValue: "1.5" })).toBe(1.5);
    });

    it("reads bytes as they arrived", () => {
      const bytes = new Uint8Array([1, 2, 3]);
      expect(otlpScalarValue({ bytesValue: bytes })).toBe(bytes);
    });

    it("decodes base64 bytes, so both transports read alike", () => {
      expect(otlpScalarValue({ bytesValue: "AQID" })).toEqual(Buffer.from([1, 2, 3]));
    });
  });

  describe("given a structurally serialised Long", () => {
    it("reassembles the two halves", () => {
      expect(otlpScalarValue({ intValue: { low: 42, high: 0 } })).toBe(42);
    });

    it("carries the high half into the result", () => {
      expect(otlpScalarValue({ intValue: { low: 0, high: 1 } })).toBe(2 ** 32);
    });

    /**
     * `low` is delivered as a SIGNED 32-bit integer, so any value at or above
     * 2^31 arrives negative. Without masking it to 32 bits before the OR, its
     * sign extends across the high half and the result is wrong by a multiple
     * of 2^32 — a timestamp off by 4295 seconds rather than an obvious error.
     */
    it("masks a negative low half rather than letting its sign reach the high half", () => {
      expect(otlpScalarValue({ intValue: { low: -1, high: 0 } })).toBe(2 ** 32 - 1);
    });

    it("reassembles a realistic nanosecond timestamp", () => {
      const nanos = 1_724_500_000_000_000_000n;
      const low = Number(BigInt.asIntN(32, nanos & 0xffffffffn));
      const high = Number(nanos >> 32n);

      expect(otlpScalarValue({ intValue: { low, high } })).toBe(Number(nanos));
    });
  });

  describe("given the oneof set more than once", () => {
    /**
     * Not conformant, but senders produce it — most often an empty
     * `stringValue` left beside the field that is really set. The reading order
     * follows OTLP's own field order, so `stringValue` wins.
     */
    it("takes the first field in the oneof's own order", () => {
      expect(otlpScalarValue({ stringValue: "", intValue: 3 })).toBe("");
      expect(otlpScalarValue({ boolValue: true, intValue: 3 })).toBe(true);
      expect(otlpScalarValue({ intValue: 3, doubleValue: 1.5 })).toBe(3);
    });
  });

  describe("given an array", () => {
    it("serialises one holding only scalars to JSON", () => {
      expect(
        otlpScalarValue({
          arrayValue: { values: [{ stringValue: "a" }, { intValue: 2 }, { boolValue: true }] },
        }),
      ).toBe('["a",2,true]');
    });

    it("answers undefined for one holding a structure, so the caller descends instead", () => {
      expect(
        otlpScalarValue({
          arrayValue: {
            values: [
              { stringValue: "a" },
              { kvlistValue: { values: [{ key: "k", value: { intValue: 1 } }] } },
            ],
          },
        }),
      ).toBeUndefined();
    });

    it("serialises an empty array, which vacuously holds only scalars", () => {
      expect(otlpScalarValue({ arrayValue: { values: [] } })).toBe("[]");
    });
  });

  describe("given a value with no scalar reading", () => {
    it("answers undefined for an empty value", () => {
      expect(otlpScalarValue({})).toBeUndefined();
    });

    it("answers undefined for a kvlist", () => {
      expect(
        otlpScalarValue({ kvlistValue: { values: [{ key: "k", value: { intValue: 1 } }] } }),
      ).toBeUndefined();
    });

    it("answers undefined when every field is explicitly null", () => {
      expect(
        otlpScalarValue({ stringValue: null, intValue: null, boolValue: null }),
      ).toBeUndefined();
    });
  });
});

describe("normalizeOtlpAttributeMap", () => {
  describe("given a flat attribute list", () => {
    it("keys each value by its attribute name", () => {
      expect(
        normalizeOtlpAttributeMap([
          { key: "service.name", value: { stringValue: "api" } },
          { key: "http.status_code", value: { intValue: 200 } },
          { key: "error", value: { boolValue: true } },
        ]),
      ).toEqual({ "service.name": "api", "http.status_code": "200", error: "true" });
    });

    it("stringifies every value, since the map is a map of strings", () => {
      const result = normalizeOtlpAttributeMap([
        { key: "n", value: { doubleValue: 1.5 } },
        { key: "b", value: { boolValue: false } },
      ]);

      expect(result).toEqual({ n: "1.5", b: "false" });
      expect(Object.values(result).every((value) => typeof value === "string")).toBe(true);
    });

    it("hex-encodes bytes, matching how identifiers are spelled elsewhere", () => {
      expect(
        normalizeOtlpAttributeMap([
          { key: "id", value: { bytesValue: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) } },
        ]),
      ).toEqual({ id: "deadbeef" });
    });

    it("hex-encodes bytes that arrived as base64, so both transports store alike", () => {
      expect(normalizeOtlpAttributeMap([{ key: "id", value: { bytesValue: "3q2+7w==" } }])).toEqual({
        id: "deadbeef",
      });
    });
  });

  describe("given a nested attribute", () => {
    it("flattens a kvlist onto dotted paths", () => {
      expect(
        normalizeOtlpAttributeMap([
          {
            key: "user",
            value: {
              kvlistValue: {
                values: [
                  { key: "id", value: { stringValue: "u-1" } },
                  { key: "admin", value: { boolValue: true } },
                ],
              },
            },
          },
        ]),
      ).toEqual({ "user.id": "u-1", "user.admin": "true" });
    });

    it("flattens nested kvlists all the way down", () => {
      expect(
        normalizeOtlpAttributeMap([
          {
            key: "a",
            value: {
              kvlistValue: {
                values: [
                  {
                    key: "b",
                    value: {
                      kvlistValue: { values: [{ key: "c", value: { stringValue: "deep" } }] },
                    },
                  },
                ],
              },
            },
          },
        ]),
      ).toEqual({ "a.b.c": "deep" });
    });

    /**
     * An all-scalar array is a scalar by `otlpScalarValue`, so it lands as one
     * JSON string. Only a MIXED array is indexed out into separate keys — the
     * distinction that decides whether a caller reads `tags` or `tags.0`.
     */
    it("keeps an all-scalar array as one JSON value rather than indexing it", () => {
      expect(
        normalizeOtlpAttributeMap([
          { key: "tags", value: { arrayValue: { values: [{ stringValue: "a" }, { intValue: 2 }] } } },
        ]),
      ).toEqual({ tags: '["a",2]' });
    });

    it("indexes a mixed array out into a key per element", () => {
      expect(
        normalizeOtlpAttributeMap([
          {
            key: "items",
            value: {
              arrayValue: {
                values: [
                  { stringValue: "first" },
                  { kvlistValue: { values: [{ key: "id", value: { intValue: 2 } }] } },
                ],
              },
            },
          },
        ]),
      ).toEqual({ "items.0": "first", "items.1.id": "2" });
    });
  });

  describe("given a string that looks like JSON", () => {
    it("normalises the sender's whitespace so two senders agree", () => {
      const spaced = normalizeOtlpAttributeMap([
        { key: "payload", value: { stringValue: '{ "b" : 1 }' } },
      ]);
      const tight = normalizeOtlpAttributeMap([
        { key: "payload", value: { stringValue: '{"b":1}' } },
      ]);

      expect(spaced).toEqual(tight);
      expect(spaced).toEqual({ payload: '{"b":1}' });
    });

    it("normalises a JSON array the same way", () => {
      expect(
        normalizeOtlpAttributeMap([{ key: "list", value: { stringValue: "[1,  2 , 3]" } }]),
      ).toEqual({ list: "[1,2,3]" });
    });

    it("keeps malformed JSON exactly as the sender wrote it", () => {
      expect(
        normalizeOtlpAttributeMap([{ key: "broken", value: { stringValue: "{not json}" } }]),
      ).toEqual({ broken: "{not json}" });
    });

    it("leaves a string that only starts like JSON alone", () => {
      expect(
        normalizeOtlpAttributeMap([{ key: "text", value: { stringValue: "{unclosed" } }]),
      ).toEqual({ text: "{unclosed" });
    });

    it("leaves ordinary prose alone", () => {
      expect(
        normalizeOtlpAttributeMap([{ key: "message", value: { stringValue: "all good" } }]),
      ).toEqual({ message: "all good" });
    });
  });

  describe("given input the ingestion path must survive", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["an object", { key: "a" }],
      ["a string", "attributes"],
      ["a number", 1],
    ])("answers an empty map for %s rather than raising", (_label, input) => {
      expect(normalizeOtlpAttributeMap(input)).toEqual({});
    });

    /**
     * One malformed attribute must not cost the whole batch, so a bad entry is
     * skipped and its neighbours still land.
     */
    it("skips an entry that is not a key-value pair and keeps the rest", () => {
      expect(
        normalizeOtlpAttributeMap([
          { key: "good", value: { stringValue: "kept" } },
          { novalue: true },
          null,
          "not an entry",
          { key: 7, value: { stringValue: "bad key" } },
          { key: "also.good", value: { intValue: 1 } },
        ]),
      ).toEqual({ good: "kept", "also.good": "1" });
    });

    it("answers an empty map for an empty list", () => {
      expect(normalizeOtlpAttributeMap([])).toEqual({});
    });

    it("drops an attribute whose value carries nothing", () => {
      expect(
        normalizeOtlpAttributeMap([
          { key: "empty", value: {} },
          { key: "present", value: { stringValue: "x" } },
        ]),
      ).toEqual({ present: "x" });
    });

    it("lets the last of two entries with one key win", () => {
      expect(
        normalizeOtlpAttributeMap([
          { key: "dup", value: { stringValue: "first" } },
          { key: "dup", value: { stringValue: "second" } },
        ]),
      ).toEqual({ dup: "second" });
    });
  });
});
