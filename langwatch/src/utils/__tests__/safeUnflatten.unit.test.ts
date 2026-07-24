import { describe, it, expect } from "vitest";
import { safeUnflatten } from "../safeUnflatten";

describe("safeUnflatten", () => {
  describe("when given flat dot-notation keys", () => {
    it("produces nested objects", () => {
      expect(safeUnflatten({ "a.b.c": 1 })).toEqual({ a: { b: { c: 1 } } });
    });

    it("handles multiple keys sharing a prefix", () => {
      expect(safeUnflatten({ "a.b": 1, "a.c": 2 })).toEqual({
        a: { b: 1, c: 2 },
      });
    });
  });

  describe("when given single-segment keys", () => {
    it("passes through without splitting", () => {
      expect(safeUnflatten({ foo: "bar" })).toEqual({ foo: "bar" });
    });
  });

  describe("when given empty input", () => {
    it("returns empty object", () => {
      expect(safeUnflatten({})).toEqual({});
    });
  });

  describe("when given prototype pollution keys", () => {
    it("blocks __proto__ at root", () => {
      const result = safeUnflatten({ __proto__: "evil" });
      expect(result).toEqual({});
      expect(Object.getPrototypeOf(result)).toBeNull();
    });

    it("blocks __proto__ at intermediate path", () => {
      const result = safeUnflatten({ "__proto__.polluted": "yes" });
      expect(result).toEqual({});
    });

    it("blocks __proto__ at leaf position", () => {
      const result = safeUnflatten({ "a.__proto__": "evil" });
      // Intermediate "a" is created but the dangerous leaf is dropped
      expect(result).toEqual({ a: {} });
      expect(Object.getPrototypeOf(result.a)).toBeNull();
    });

    it("blocks constructor key", () => {
      const result = safeUnflatten({ "constructor.polluted": "yes" });
      expect(result).toEqual({});
    });

    it("blocks prototype key", () => {
      const result = safeUnflatten({ "prototype.polluted": "yes" });
      expect(result).toEqual({});
    });
  });

  describe("when given leaf values", () => {
    it("preserves array leaf values", () => {
      expect(safeUnflatten({ "a.b": [1, 2, 3] })).toEqual({
        a: { b: [1, 2, 3] },
      });
    });

    it("preserves object leaf values", () => {
      expect(safeUnflatten({ "a.b": { nested: true } })).toEqual({
        a: { b: { nested: true } },
      });
    });

    it("preserves scalar values", () => {
      expect(
        safeUnflatten({ "a.str": "hello", "a.num": 42, "a.bool": true }),
      ).toEqual({
        a: { str: "hello", num: 42, bool: true },
      });
    });
  });

  describe("when an intermediate position has a conflicting value", () => {
    it("overwrites a scalar intermediate with a nested object", () => {
      // Last-write wins: "a.b" = "scalar" then "a.b.c" = 1 → a.b becomes object
      const result = safeUnflatten({ "a.b": "scalar", "a.b.c": 1 });
      expect(result).toEqual({ a: { b: { c: 1 } } });
    });

    it("overwrites an array intermediate with a nested object", () => {
      const result = safeUnflatten({ "a.b": [1, 2], "a.b.c": 1 });
      expect(result).toEqual({ a: { b: { c: 1 } } });
    });
  });
});
