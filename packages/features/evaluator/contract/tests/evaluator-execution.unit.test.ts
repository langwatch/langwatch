import { describe, expect, it } from "vitest";
import { coerceEvaluatorScalar } from "../src";

describe("evaluator input coercion", () => {
  it("preserves strings and absent values", () => {
    expect(coerceEvaluatorScalar("hello")).toBe("hello");
    expect(coerceEvaluatorScalar("")).toBe("");
    expect(coerceEvaluatorScalar(null)).toBeNull();
    expect(coerceEvaluatorScalar(void 0)).toBeUndefined();
  });

  it("converts scalar values without accepting non-finite numbers", () => {
    expect(coerceEvaluatorScalar(true)).toBe("true");
    expect(coerceEvaluatorScalar(false)).toBe("false");
    expect(coerceEvaluatorScalar(42)).toBe("42");
    expect(coerceEvaluatorScalar(0.5)).toBe("0.5");
    expect(coerceEvaluatorScalar(BigInt("9007199254740993"))).toBe("9007199254740993");
    expect(coerceEvaluatorScalar(NaN)).toBeNull();
    expect(coerceEvaluatorScalar(Infinity)).toBeNull();
  });

  it("serialises structured evaluator inputs", () => {
    expect(coerceEvaluatorScalar({ a: 1 })).toBe('{"a":1}');
    expect(coerceEvaluatorScalar([1, 2, 3])).toBe("[1,2,3]");
    expect(coerceEvaluatorScalar({ a: [1, { b: true }] })).toBe('{"a":[1,{"b":true}]}');
  });
});
