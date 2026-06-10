import { describe, expect, it } from "vitest";

import { formatBudgetUsd } from "../formatBudgetUsd";

describe("formatBudgetUsd", () => {
  describe("when amount is exactly zero", () => {
    it("renders $0.00 with two decimals", () => {
      expect(formatBudgetUsd(0)).toBe("$0.00");
      expect(formatBudgetUsd("0")).toBe("$0.00");
      expect(formatBudgetUsd("0.000000")).toBe("$0.00");
    });
  });

  describe("when amount is below one cent", () => {
    it("renders full micro-cent precision so dogfood spend is visible", () => {
      expect(formatBudgetUsd(0.000165)).toBe("$0.000165");
      expect(formatBudgetUsd("0.000033")).toBe("$0.000033");
      expect(formatBudgetUsd(0.001)).toBe("$0.001");
    });

    it("trims trailing zeros so micro values stay readable", () => {
      expect(formatBudgetUsd(0.0001)).toBe("$0.0001");
      expect(formatBudgetUsd(0.00012)).toBe("$0.00012");
    });
  });

  describe("when amount is between $0.01 and $1", () => {
    it("uses five decimals trimmed of trailing zeros", () => {
      expect(formatBudgetUsd(0.5)).toBe("$0.5");
      expect(formatBudgetUsd(0.5)).not.toBe("$0.50000");
      expect(formatBudgetUsd(0.123456)).toBe("$0.12346");
    });
  });

  describe("when amount is one dollar or greater", () => {
    it("uses two-decimal currency formatting", () => {
      expect(formatBudgetUsd(1)).toBe("$1.00");
      expect(formatBudgetUsd(1247.35)).toBe("$1247.35");
      expect(formatBudgetUsd("5000")).toBe("$5000.00");
    });
  });

  describe("when amount is invalid", () => {
    it("renders an em-dash placeholder", () => {
      expect(formatBudgetUsd(null)).toBe("—");
      expect(formatBudgetUsd(undefined)).toBe("—");
      expect(formatBudgetUsd("not-a-number")).toBe("—");
      expect(formatBudgetUsd(NaN)).toBe("—");
    });
  });
});
