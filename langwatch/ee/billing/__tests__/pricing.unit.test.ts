import { describe, expect, it } from "vitest";
import {
  getGrowthSeatPriceCents,
  getAnnualDiscountPercent,
  formatPrice,
} from "../pricing";

describe("pricing", () => {
  describe("getGrowthSeatPriceCents()", () => {
    it("returns EUR monthly at 2900 cents", () => {
      expect(getGrowthSeatPriceCents().EUR.monthly).toBe(2900);
    });

    it("returns EUR annual at 32000 cents", () => {
      expect(getGrowthSeatPriceCents().EUR.annual).toBe(32000);
    });

    it("returns USD monthly at 3200 cents", () => {
      expect(getGrowthSeatPriceCents().USD.monthly).toBe(3200);
    });

    it("returns USD annual at 35328 cents", () => {
      expect(getGrowthSeatPriceCents().USD.annual).toBe(35328);
    });
  });

  describe("getAnnualDiscountPercent()", () => {
    it("returns 8 for EUR", () => {
      expect(getAnnualDiscountPercent("EUR")).toBe(8);
    });

    it("returns 8 for USD", () => {
      expect(getAnnualDiscountPercent("USD")).toBe(8);
    });
  });

  describe("formatPrice()", () => {
    it("formats whole EUR amount without decimals", () => {
      expect(formatPrice(2900, "EUR")).toBe("\u20AC29");
    });

    it("formats fractional USD amount with decimals", () => {
      expect(formatPrice(35328, "USD")).toBe("$353.28");
    });

    it("formats large EUR amount with thousands separator", () => {
      expect(formatPrice(128000, "EUR")).toBe("\u20AC1,280");
    });

    it("formats zero correctly", () => {
      expect(formatPrice(0, "EUR")).toBe("\u20AC0");
    });
  });
});
