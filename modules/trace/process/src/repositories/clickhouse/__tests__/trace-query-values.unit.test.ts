/** The two refusals a filter gets before any SQL is built: bounded keys and
 * values. Removes the key's character check and nothing fails. */

import { describe, expect, it } from "vitest";

import {
  MAX_ATTRIBUTE_KEY_LENGTH,
  MAX_VALUE_LENGTH,
  ClickHouseTraceQueryValuesRepository,
} from "../clickhouse.trace-query-values.repository.ts";

const traceQueryValuesRepository = ClickHouseTraceQueryValuesRepository.create();

describe("traceQueryValuesRepository.validateAttributeKey", () => {
  describe("given a key that reads like an identifier", () => {
    it.each(["model", "llm.model_name", "service/name", "http:status", "user-id", "a1"])(
      "accepts %s",
      (key) => {
        expect(() => traceQueryValuesRepository.validateAttributeKey(key)).not.toThrow();
      },
    );
  });

  describe("given a key that does not", () => {
    it("refuses one that is empty, rather than filtering on nothing", () => {
      expect(() => traceQueryValuesRepository.validateAttributeKey("")).toThrow(/cannot be empty/i);
    });

    it.each(["has space", "quote'd", "semi;colon", "brace{}", "star*"])(
      "refuses %s and says which characters are allowed",
      (key) => {
        // The message has to name the allowed set: the person typed this into
        // a filter box and the refusal is the only thing telling them what to
        // type instead.
        expect(() => traceQueryValuesRepository.validateAttributeKey(key)).toThrow(
          /invalid characters/i,
        );
        expect(() => traceQueryValuesRepository.validateAttributeKey(key)).toThrow(
          /letters, digits/i,
        );
      },
    );

    it("refuses one past the length bound", () => {
      const tooLong = "a".repeat(MAX_ATTRIBUTE_KEY_LENGTH + 1);

      expect(() => traceQueryValuesRepository.validateAttributeKey(tooLong)).toThrow(/too long/i);
    });

    it("accepts one exactly at the bound, so the limit is inclusive", () => {
      const atBound = "a".repeat(MAX_ATTRIBUTE_KEY_LENGTH);

      expect(() => traceQueryValuesRepository.validateAttributeKey(atBound)).not.toThrow();
    });
  });
});

describe("traceQueryValuesRepository.validateValueLength", () => {
  it("accepts a value at the bound", () => {
    expect(() =>
      traceQueryValuesRepository.validateValueLength("v".repeat(MAX_VALUE_LENGTH)),
    ).not.toThrow();
  });

  it("refuses one past it, naming the limit", () => {
    expect(() =>
      traceQueryValuesRepository.validateValueLength("v".repeat(MAX_VALUE_LENGTH + 1)),
    ).toThrow(new RegExp(`max ${MAX_VALUE_LENGTH} characters`));
  });

  it("accepts an empty value, which is a filter for the empty string", () => {
    expect(() => traceQueryValuesRepository.validateValueLength("")).not.toThrow();
  });
});

describe("traceQueryValuesRepository.nextParam", () => {
  it("mints a fresh name each time, so two values cannot collide", () => {
    const ctx = { params: {} as Record<string, unknown>, paramIndex: 0 } as never;
    const first = traceQueryValuesRepository.nextParam(ctx, "attrKey");
    const second = traceQueryValuesRepository.nextParam(ctx, "attrKey");

    expect(first).not.toBe(second);
  });
});
