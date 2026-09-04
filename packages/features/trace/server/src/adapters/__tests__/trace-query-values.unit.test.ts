/**
 * The two refusals a filter gets before any SQL is built.
 *
 * Neither is the injection defence — every value and every attribute key is
 * BOUND as a `{name:String}` parameter, which is what makes the query safe.
 * These are the bounds and the readable refusal on top of that: an attribute
 * key is an identifier, so a key full of punctuation is a typo rather than a
 * filter that should quietly match nothing, and an unbounded value would be
 * carried into the query as-is.
 *
 * Both were unguarded until this test: removing the key's character check
 * failed nothing in the suite.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_ATTRIBUTE_KEY_LENGTH,
  MAX_VALUE_LENGTH,
  TraceQueryValuesAdapter,
} from "../trace-query-values.clickhouse.adapter";

describe("TraceQueryValuesAdapter.validateAttributeKey", () => {
  describe("given a key that reads like an identifier", () => {
    it.each(["model", "llm.model_name", "service/name", "http:status", "user-id", "a1"])(
      "accepts %s",
      (key) => {
        expect(() => TraceQueryValuesAdapter.validateAttributeKey(key)).not.toThrow();
      },
    );
  });

  describe("given a key that does not", () => {
    it("refuses one that is empty, rather than filtering on nothing", () => {
      expect(() => TraceQueryValuesAdapter.validateAttributeKey("")).toThrow(/cannot be empty/i);
    });

    it.each(["has space", "quote'd", "semi;colon", "brace{}", "star*"])(
      "refuses %s and says which characters are allowed",
      (key) => {
        // The message has to name the allowed set: the person typed this into
        // a filter box and the refusal is the only thing telling them what to
        // type instead.
        expect(() => TraceQueryValuesAdapter.validateAttributeKey(key)).toThrow(
          /invalid characters/i,
        );
        expect(() => TraceQueryValuesAdapter.validateAttributeKey(key)).toThrow(/letters, digits/i);
      },
    );

    it("refuses one past the length bound", () => {
      const tooLong = "a".repeat(MAX_ATTRIBUTE_KEY_LENGTH + 1);

      expect(() => TraceQueryValuesAdapter.validateAttributeKey(tooLong)).toThrow(/too long/i);
    });

    it("accepts one exactly at the bound, so the limit is inclusive", () => {
      const atBound = "a".repeat(MAX_ATTRIBUTE_KEY_LENGTH);

      expect(() => TraceQueryValuesAdapter.validateAttributeKey(atBound)).not.toThrow();
    });
  });
});

describe("TraceQueryValuesAdapter.validateValueLength", () => {
  it("accepts a value at the bound", () => {
    expect(() =>
      TraceQueryValuesAdapter.validateValueLength("v".repeat(MAX_VALUE_LENGTH)),
    ).not.toThrow();
  });

  it("refuses one past it, naming the limit", () => {
    expect(() =>
      TraceQueryValuesAdapter.validateValueLength("v".repeat(MAX_VALUE_LENGTH + 1)),
    ).toThrow(new RegExp(`max ${MAX_VALUE_LENGTH} characters`));
  });

  it("accepts an empty value, which is a filter for the empty string", () => {
    expect(() => TraceQueryValuesAdapter.validateValueLength("")).not.toThrow();
  });
});

describe("TraceQueryValuesAdapter.nextParam", () => {
  it("mints a fresh name each time, so two values cannot collide", () => {
    const ctx = { params: {} as Record<string, unknown>, paramIndex: 0 } as never;
    const first = TraceQueryValuesAdapter.nextParam(ctx, "attrKey");
    const second = TraceQueryValuesAdapter.nextParam(ctx, "attrKey");

    expect(first).not.toBe(second);
  });
});
