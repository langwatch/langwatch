import { describe, expect, it } from "vitest";

import { coerceEvaluatorScalar } from "../coerceEvaluatorScalar";

describe("coerceEvaluatorScalar", () => {
  describe("when value is a string", () => {
    it("passes the string through unchanged", () => {
      expect(coerceEvaluatorScalar("hello")).toBe("hello");
      expect(coerceEvaluatorScalar("")).toBe("");
    });
  });

  describe("when value is null or undefined", () => {
    it("preserves null", () => {
      expect(coerceEvaluatorScalar(null)).toBeNull();
    });

    it("preserves undefined", () => {
      expect(coerceEvaluatorScalar(undefined)).toBeUndefined();
    });
  });

  describe("when value is a boolean", () => {
    it("coerces true to the string 'true'", () => {
      expect(coerceEvaluatorScalar(true)).toBe("true");
    });

    it("coerces false to the string 'false'", () => {
      expect(coerceEvaluatorScalar(false)).toBe("false");
    });
  });

  describe("when value is a number", () => {
    it("coerces integers to their string form", () => {
      expect(coerceEvaluatorScalar(42)).toBe("42");
      expect(coerceEvaluatorScalar(0)).toBe("0");
      expect(coerceEvaluatorScalar(-1)).toBe("-1");
    });

    it("coerces floats to their string form", () => {
      expect(coerceEvaluatorScalar(0.5)).toBe("0.5");
    });

    it("nulls out non-finite numbers so the schema rejects them rather than coerces 'NaN'/'Infinity'", () => {
      expect(coerceEvaluatorScalar(NaN)).toBeNull();
      expect(coerceEvaluatorScalar(Infinity)).toBeNull();
      expect(coerceEvaluatorScalar(-Infinity)).toBeNull();
    });
  });

  describe("when value is a bigint", () => {
    it("coerces to its decimal string form", () => {
      expect(coerceEvaluatorScalar(BigInt("9007199254740993"))).toBe(
        "9007199254740993",
      );
    });
  });

  describe("when value is an object or array", () => {
    it("JSON-stringifies plain objects", () => {
      expect(coerceEvaluatorScalar({ a: 1 })).toBe('{"a":1}');
    });

    it("JSON-stringifies arrays", () => {
      expect(coerceEvaluatorScalar([1, 2, 3])).toBe("[1,2,3]");
    });

    it("JSON-stringifies nested structures", () => {
      expect(coerceEvaluatorScalar({ a: [1, { b: true }] })).toBe(
        '{"a":[1,{"b":true}]}',
      );
    });
  });
});
