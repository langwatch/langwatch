import { describe, expect, it } from "vitest";

import { ensureJsonSafe, JsonSafetyError } from "../json";

describe("ensureJsonSafe", () => {
  describe("given a JSON-representable value", () => {
    it("returns primitives unchanged", () => {
      expect(ensureJsonSafe(null)).toBe(null);
      expect(ensureJsonSafe(true)).toBe(true);
      expect(ensureJsonSafe(0)).toBe(0);
      expect(ensureJsonSafe(-12.5)).toBe(-12.5);
      expect(ensureJsonSafe("hello")).toBe("hello");
      expect(ensureJsonSafe("")).toBe("");
    });

    it("returns nested arrays and plain objects unchanged", () => {
      const value = {
        a: [1, "two", null, { deep: [true, { deeper: "x" }] }],
        b: { c: {} },
      };
      expect(ensureJsonSafe(value)).toBe(value);
    });

    it("accepts null-prototype objects", () => {
      const value = Object.create(null) as Record<string, unknown>;
      value.key = "value";
      expect(ensureJsonSafe(value)).toBe(value);
    });
  });

  describe("given a value JSON.stringify would silently mangle", () => {
    it("rejects undefined nested inside an object", () => {
      expect(() => ensureJsonSafe({ a: { b: undefined } })).toThrow(
        JsonSafetyError,
      );
    });

    it("rejects undefined at the root", () => {
      expect(() => ensureJsonSafe(undefined)).toThrow(JsonSafetyError);
    });

    it("rejects NaN and non-finite numbers", () => {
      expect(() => ensureJsonSafe({ a: NaN })).toThrow(JsonSafetyError);
      expect(() => ensureJsonSafe({ a: Infinity })).toThrow(JsonSafetyError);
      expect(() => ensureJsonSafe({ a: -Infinity })).toThrow(JsonSafetyError);
    });

    it("rejects Date instances", () => {
      expect(() => ensureJsonSafe({ at: new Date(0) })).toThrow(
        JsonSafetyError,
      );
    });

    it("rejects Map, Set, and other non-plain object instances", () => {
      expect(() => ensureJsonSafe({ a: new Map() })).toThrow(JsonSafetyError);
      expect(() => ensureJsonSafe({ a: new Set() })).toThrow(JsonSafetyError);
      class Thing {
        x = 1;
      }
      expect(() => ensureJsonSafe({ a: new Thing() })).toThrow(
        JsonSafetyError,
      );
    });
  });

  describe("given a value JSON.stringify would throw on or drop", () => {
    it("rejects functions", () => {
      expect(() => ensureJsonSafe({ fn: () => 1 })).toThrow(JsonSafetyError);
    });

    it("rejects bigint", () => {
      expect(() => ensureJsonSafe({ n: 1n })).toThrow(JsonSafetyError);
    });

    it("rejects symbol-keyed properties", () => {
      expect(() => ensureJsonSafe({ [Symbol("hidden")]: 1 })).toThrow(
        JsonSafetyError,
      );
    });

    it("rejects circular references", () => {
      const value: Record<string, unknown> = {};
      value.self = value;
      expect(() => ensureJsonSafe(value)).toThrow(JsonSafetyError);
    });
  });

  describe("when rejecting a value", () => {
    it("reports the path to the offending value", () => {
      try {
        ensureJsonSafe({ a: [1, { b: undefined }] });
        expect.unreachable("expected ensureJsonSafe to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(JsonSafetyError);
        expect((error as JsonSafetyError).path).toBe("$.a[1].b");
      }
    });
  });
});
