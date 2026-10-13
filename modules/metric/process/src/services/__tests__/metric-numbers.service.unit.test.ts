/**
 * Tests bounds checking for OTLP numbers before storage. RANGE violations throw;
 * unreadable values return null (caller drops point instead of losing batch). This
 * logic was unguarded until this test.
 */

import { describe, expect, it } from "vitest";

import {
  checkedDouble,
  checkedInteger,
  parseOptionalDouble,
  toFiniteNumber,
  finiteNumbers,
  MAX_INT32,
  MAX_INT64,
  MAX_UINT32,
  MAX_UINT64,
  MIN_INT32,
  timestampMs,
} from "../../rules/metric-numbers.rules.ts";

const uint64 = (value: unknown) =>
  checkedInteger({ value, label: "count", min: 0n, max: MAX_UINT64 });
const int32 = (value: unknown) =>
  checkedInteger({ value, label: "scale", min: MIN_INT32, max: MAX_INT32 });

describe("checkedInteger", () => {
  describe("given a value inside the declared range", () => {
    it("answers it as an exact bigint, whether it arrived as a number or a string", () => {
      expect(uint64(42)).toBe(42n);
      expect(uint64("42")).toBe(42n);
    });

    it("keeps the full width of a UInt64, which a JS number cannot hold", () => {
      // The reason the unit is bigint at all: this value is exact here and
      // would lose its low digits as a number.
      expect(uint64(MAX_UINT64.toString())).toBe(MAX_UINT64);
    });

    it("accepts both ends of a signed range", () => {
      expect(int32(MIN_INT32.toString())).toBe(MIN_INT32);
      expect(int32(MAX_INT32.toString())).toBe(MAX_INT32);
    });
  });

  describe("given a value outside it", () => {
    it("refuses one past the top, naming the range", () => {
      expect(() => uint64((MAX_UINT64 + 1n).toString())).toThrow(/outside its OTLP integer range/);
    });

    it("refuses a negative for an unsigned field", () => {
      expect(() => uint64("-1")).toThrow(/outside its OTLP integer range/);
    });

    it("refuses one past a signed range at either end", () => {
      expect(() => int32((MIN_INT32 - 1n).toString())).toThrow(/outside its OTLP integer range/);
      expect(() => int32((MAX_INT32 + 1n).toString())).toThrow(/outside its OTLP integer range/);
    });

    it("names the field, so the refusal says WHICH number was wrong", () => {
      expect(() =>
        checkedInteger({
          value: "-1",
          label: "bucketCount",
          min: 0n,
          max: MAX_INT64,
        }),
      ).toThrow(/bucketCount/);
    });
  });

  describe("given something that is not an integer at all", () => {
    it("refuses a fractional number rather than truncating it", () => {
      expect(() => uint64(1.5)).toThrow(/not a safely represented integer/);
    });

    it("refuses a number past the safe-integer boundary, which has already lost digits", () => {
      expect(() => uint64(Number.MAX_SAFE_INTEGER + 2)).toThrow(/safely represented/);
    });

    it("refuses text that is not a number", () => {
      expect(() => uint64("twelve")).toThrow(/not an integer/);
    });
  });
});

describe("toFiniteNumber", () => {
  it("reads a number, and a number written as text", () => {
    expect(toFiniteNumber(1.25)).toBe(1.25);
    expect(toFiniteNumber("1.25")).toBe(1.25);
  });

  it("answers null rather than propagating a non-finite value", () => {
    // NaN and Infinity survive arithmetic silently and land in a chart as a
    // gap nobody can account for.
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumber("not a number")).toBeNull();
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
  });

  it("keeps zero, which is a measurement and not an absent one", () => {
    expect(toFiniteNumber(0)).toBe(0);
  });
});

describe("checkedDouble", () => {
  it("throws where the optional form would answer null", () => {
    expect(parseOptionalDouble({ value: undefined, label: "sum" })).toBeNull();
    expect(() => checkedDouble({ value: undefined, label: "sum" })).toThrow(/sum/);
  });
});

describe("timestampMs", () => {
  it("turns OTLP nanoseconds into milliseconds", () => {
    expect(timestampMs("1787000000000000000")).toBe(1_787_000_000_000);
  });

  it("refuses a stamp a Date cannot hold, rather than answering an invalid one", () => {
    expect(() => timestampMs("99999999999999999999999")).toThrow(
      /outside the supported Date range/,
    );
  });

  it("refuses a negative stamp", () => {
    expect(() => timestampMs("-1000000")).toThrow(/outside the supported Date range/);
  });
});

describe("finiteNumbers", () => {
  it("drops the unreadable entries rather than the whole list", () => {
    expect(finiteNumbers([1, "2", Number.NaN, "x", 3])).toEqual([1, 2, 3]);
  });

  it("answers empty for something that is not a list", () => {
    expect(finiteNumbers("nope")).toEqual([]);
  });
});

describe("the exported bounds", () => {
  it("are the OTLP widths the checks are called with", () => {
    expect(MAX_UINT32).toBe(4_294_967_295n);
    expect(MAX_UINT64).toBe(18_446_744_073_709_551_615n);
    expect(MAX_INT64).toBe(9_223_372_036_854_775_807n);
  });
});
