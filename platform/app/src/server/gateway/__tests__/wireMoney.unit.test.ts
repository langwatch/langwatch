/**
 * @vitest-environment node
 *
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  decimalUsdToNanoUsd,
  nanoUsdToDecimalString,
  usdDisplayString,
  usdToNanoUsd,
} from "../wireMoney";

/**
 * The value a customer reported on `GET /virtual-keys/{id}/spend`: 45
 * micro-USD of spend, as ClickHouse stringifies the `Float64` sum of it.
 */
const FLOAT64_SUM_OF_45_MICRO_USD = "0.000044999999999999996";

describe("nanoUsdToDecimalString", () => {
  /** @scenario A `_usd` string is rendered from the integer, never from a float */
  it("renders up to nine fractional digits with trailing zeros trimmed", () => {
    expect(nanoUsdToDecimalString(0)).toBe("0");
    expect(nanoUsdToDecimalString(1_000_000_000)).toBe("1");
    expect(nanoUsdToDecimalString(25_500_000_000)).toBe("25.5");
    expect(nanoUsdToDecimalString(3_210_000_000)).toBe("3.21");
    expect(nanoUsdToDecimalString(45_000)).toBe("0.000045");
  });

  /** @scenario A `_usd` string is rendered from the integer, never from a float */
  it("keeps the nano digits `.toFixed(6)` used to drop", () => {
    // A one-nano charge rendered as "0.000000" under the old float path, so
    // the smallest amount the unit can express published as nothing at all.
    expect(nanoUsdToDecimalString(1)).toBe("0.000000001");
    expect(nanoUsdToDecimalString(999)).toBe("0.000000999");
    expect(nanoUsdToDecimalString(1_234_567_891)).toBe("1.234567891");
  });

  /** @scenario A `_usd` string is rendered from the integer, never from a float */
  it("never falls into exponent notation, at either end of the range", () => {
    for (const nano of [1, 999, 45_000, 9_007_199_254_740_991]) {
      expect(nanoUsdToDecimalString(nano)).not.toMatch(/[eE]/);
    }
    // Past the safe integer range the string still reads, because it is
    // digits rather than a JSON number.
    expect(nanoUsdToDecimalString(999_999_999_999_999_999_000n)).toBe(
      "999999999999.999999",
    );
    expect(nanoUsdToDecimalString(-1_500_000_000n)).toBe("-1.5");
  });
});

describe("usdToNanoUsd", () => {
  /** @scenario A budget amount converts to nano-USD without float drift */
  it("scales the decimal string exactly", () => {
    expect(usdToNanoUsd(new Prisma.Decimal("25.500000"))).toBe(25_500_000_000n);
    expect(usdToNanoUsd("0.000001")).toBe(1_000n);
    expect(usdToNanoUsd("0")).toBe(0n);
    expect(usdToNanoUsd("-1.5")).toBe(-1_500_000_000n);
  });

  /** @scenario A Float64 spend sum publishes the amount, not its measurement drift */
  it("rounds the drift off a Float64 sum rather than truncating into it", () => {
    // Truncating at the ninth digit would keep the drift and publish 44999
    // nano, which is the artifact rather than the amount.
    expect(usdToNanoUsd(FLOAT64_SUM_OF_45_MICRO_USD)).toBe(45_000n);
    expect(usdToNanoUsd("0.0000000005")).toBe(1n);
    expect(usdToNanoUsd("0.0000000004")).toBe(0n);
  });

  /** @scenario A Float64 spend sum publishes the amount, not its measurement drift */
  it("reads the exponent notation ClickHouse emits for small sums", () => {
    expect(usdToNanoUsd("4.4999999999999996e-5")).toBe(45_000n);
    expect(usdToNanoUsd("1e-9")).toBe(1n);
    expect(usdToNanoUsd("1E-12")).toBe(0n);
    expect(usdToNanoUsd("1.25e2")).toBe(125_000_000_000n);
  });

  it("refuses anything that is not a decimal amount", () => {
    // A money field is not a place to guess: the alternative to throwing is
    // publishing `NaN` as a price.
    for (const bad of ["nan", "inf", "", "abc", "1.2.3", "$1.00"]) {
      expect(() => usdToNanoUsd(bad)).toThrow(/decimal money amount/);
    }
  });
});

describe("usdDisplayString", () => {
  /** @scenario A Float64 spend sum publishes the amount, not its measurement drift */
  it("publishes the reported spend as a clean decimal string", () => {
    expect(usdDisplayString(FLOAT64_SUM_OF_45_MICRO_USD)).toBe("0.000045");
  });

  /** @scenario A `_usd` string is rendered from the integer, never from a float */
  it("renders zero, sub-cent and large amounts in one form", () => {
    expect(usdDisplayString("0")).toBe("0");
    expect(usdDisplayString(new Prisma.Decimal("0.000000"))).toBe("0");
    // Sub-cent, the range the gateway actually bills a single request in.
    expect(usdDisplayString("0.0000012")).toBe("0.0000012");
    expect(usdDisplayString("0.000000001")).toBe("0.000000001");
    // Large: the widest a `Decimal(18,6)` budget column can hold, which is
    // past the safe integer range in nano and so has no `_nano_usd` figure.
    expect(usdDisplayString("999999999999.999999")).toBe("999999999999.999999");
    expect(decimalUsdToNanoUsd("999999999999.999999")).toBeNull();
  });

  /** @scenario A Float64 spend sum publishes the amount, not its measurement drift */
  it("agrees with the nano integer published beside it", () => {
    for (const amount of [
      FLOAT64_SUM_OF_45_MICRO_USD,
      "0",
      "0.000000001",
      "25.5",
      "9007199.254740991",
    ]) {
      const nano = decimalUsdToNanoUsd(amount);
      expect(nano).not.toBeNull();
      expect(usdDisplayString(amount)).toBe(nanoUsdToDecimalString(nano!));
    }
  });
});

describe("decimalUsdToNanoUsd", () => {
  /** @scenario A budget amount converts to nano-USD without float drift */
  it("scales the decimal string exactly", () => {
    // 0.1 + 0.2 arithmetic is why this scales the STRING: `toNumber() * 1e9`
    // on these lands fractions of a cent away from the true integer.
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("25.500000"))).toBe(
      25_500_000_000,
    );
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("0.000001"))).toBe(1_000);
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("0.070000"))).toBe(
      70_000_000,
    );
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("0"))).toBe(0);
  });

  /** @scenario An amount past the safe integer range reports no nano figure */
  it("returns null rather than a silently rounded number", () => {
    // Past 2^53 nano-USD a JSON number has already lost the low digits, and a
    // wrong money figure is worse than an absent one.
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("9007199.254740991"))).toBe(
      9_007_199_254_740_991,
    );
    expect(decimalUsdToNanoUsd(new Prisma.Decimal("10000000"))).toBeNull();
    // The display string keeps reading where the integer cannot.
    expect(usdDisplayString(new Prisma.Decimal("10000000"))).toBe("10000000");
  });
});
