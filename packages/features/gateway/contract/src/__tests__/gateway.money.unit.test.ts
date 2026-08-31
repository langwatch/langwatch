/**
 * Money in and out of its exact integer form.
 *
 * Everything downstream of this is bigint nano-USD precisely so that a share
 * of an hourly bill — routinely a fraction of a cent — survives being added
 * up. That only holds if the two edges are exact, so what matters here is the
 * boundaries: the ninth decimal place, the rounding at it, the digits beyond
 * it, and the sign.
 *
 * The sign is the one with no obvious caller today and the worst failure if it
 * breaks. A credit on a vendor bill is negative, and dropping the minus turns
 * a refund into a charge of the same size.
 */

import { describe, expect, it } from "vitest";
import { nanoUsdToDecimalString, usdToNanoUsd } from "../gateway.money";

describe("usdToNanoUsd", () => {
  describe("given an ordinary amount", () => {
    it("scales dollars to nano-USD", () => {
      expect(usdToNanoUsd("1")).toBe(1_000_000_000n);
      expect(usdToNanoUsd("6.00")).toBe(6_000_000_000n);
      expect(usdToNanoUsd("0.000000001")).toBe(1n);
    });

    it("reads zero as zero, however it is written", () => {
      expect(usdToNanoUsd("0")).toBe(0n);
      expect(usdToNanoUsd("0.0")).toBe(0n);
      expect(usdToNanoUsd(".0")).toBe(0n);
    });

    it("takes anything that can say its own decimal, not just a string", () => {
      expect(usdToNanoUsd({ toString: () => "2.5" })).toBe(2_500_000_000n);
    });

    it("ignores surrounding whitespace", () => {
      expect(usdToNanoUsd("  3.25  ")).toBe(3_250_000_000n);
    });
  });

  describe("given a credit", () => {
    it("keeps the sign", () => {
      expect(usdToNanoUsd("-1.5")).toBe(-1_500_000_000n);
    });

    it("keeps it on the smallest amount that survives rounding", () => {
      // A credit that rounds to zero has no sign left to keep: BigInt has no
      // negative zero, so `-0n` and `0n` are the same value.
      expect(usdToNanoUsd("-0.0000000006")).toBe(-1n);
      expect(usdToNanoUsd("-0.0000000004")).toBe(0n);
    });
  });

  describe("given more precision than nano-USD can hold", () => {
    it("rounds half up at the ninth decimal place", () => {
      expect(usdToNanoUsd("0.0000000004")).toBe(0n);
      expect(usdToNanoUsd("0.0000000005")).toBe(1n);
      expect(usdToNanoUsd("0.0000000006")).toBe(1n);
    });

    it("rounds on the first digit past the ninth, not on the whole tail", () => {
      // 0.00000000049999 is below the halfway point, so it must not round up.
      expect(usdToNanoUsd("0.00000000049999")).toBe(0n);
    });
  });

  describe("given a vendor's exponent notation", () => {
    it("reads it", () => {
      expect(usdToNanoUsd("1e-9")).toBe(1n);
      expect(usdToNanoUsd("1.5e2")).toBe(150_000_000_000n);
      expect(usdToNanoUsd("2E-3")).toBe(2_000_000n);
    });
  });

  describe("given something that is not a decimal amount", () => {
    it("refuses rather than reading it as zero", () => {
      // Zero is a real answer here — a free query costs nothing — so a value
      // nobody can parse must not become one.
      expect(() => usdToNanoUsd("")).toThrow(/not a decimal money amount/i);
      expect(() => usdToNanoUsd("free")).toThrow(/not a decimal money amount/i);
      expect(() => usdToNanoUsd("$1.00")).toThrow(/not a decimal money amount/i);
    });
  });
});

describe("nanoUsdToDecimalString", () => {
  describe("given a whole number of dollars", () => {
    it("writes no decimal part at all", () => {
      expect(nanoUsdToDecimalString(6_000_000_000n)).toBe("6");
      expect(nanoUsdToDecimalString(0n)).toBe("0");
    });
  });

  describe("given a fraction", () => {
    it("writes it without trailing zeros", () => {
      expect(nanoUsdToDecimalString(1_500_000_000n)).toBe("1.5");
      expect(nanoUsdToDecimalString(1_230_000_000n)).toBe("1.23");
    });

    it("keeps the leading zeros a small amount needs", () => {
      expect(nanoUsdToDecimalString(1n)).toBe("0.000000001");
      expect(nanoUsdToDecimalString(10n)).toBe("0.00000001");
    });
  });

  describe("given a credit", () => {
    it("keeps the sign", () => {
      expect(nanoUsdToDecimalString(-1_500_000_000n)).toBe("-1.5");
      expect(nanoUsdToDecimalString(-1n)).toBe("-0.000000001");
    });
  });

  describe("given a number rather than a bigint", () => {
    it("takes it, rounding a fractional one instead of throwing", () => {
      // `BigInt(1.5)` is a RangeError. Money that arrived as a float from a
      // JSON read must not crash the delivery that is reporting it.
      expect(nanoUsdToDecimalString(1_500_000_000)).toBe("1.5");
      expect(nanoUsdToDecimalString(1.5)).toBe("0.000000002");
    });
  });

  describe("round trip", () => {
    it("returns the amount it was given", () => {
      for (const amount of ["0", "1", "6.5", "0.000000001", "-2.25", "1234.567891234"]) {
        expect(nanoUsdToDecimalString(usdToNanoUsd(amount))).toBe(amount);
      }
    });
  });
});
