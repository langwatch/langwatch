import { describe, expect, it } from "vitest";
import { getCurrencyFromCountry } from "../utils/currency";

describe("getCurrencyFromCountry", () => {
  describe("when given a eurozone country code", () => {
    it("returns EUR for Germany", () => {
      expect(getCurrencyFromCountry("DE")).toBe("EUR");
    });

    it("returns EUR for France", () => {
      expect(getCurrencyFromCountry("FR")).toBe("EUR");
    });

    it("returns EUR for Italy", () => {
      expect(getCurrencyFromCountry("IT")).toBe("EUR");
    });
  });

  describe("when given a non-eurozone country code", () => {
    it("returns USD for United States", () => {
      expect(getCurrencyFromCountry("US")).toBe("USD");
    });

    it("returns USD for Great Britain", () => {
      expect(getCurrencyFromCountry("GB")).toBe("USD");
    });

    it("returns USD for Japan", () => {
      expect(getCurrencyFromCountry("JP")).toBe("USD");
    });
  });

  describe("when given null or undefined", () => {
    it("returns EUR for null", () => {
      expect(getCurrencyFromCountry(null)).toBe("EUR");
    });

    it("returns EUR for undefined", () => {
      expect(getCurrencyFromCountry(undefined)).toBe("EUR");
    });
  });

  describe("when given a lowercase country code", () => {
    it("handles case-insensitive matching", () => {
      expect(getCurrencyFromCountry("de")).toBe("EUR");
      expect(getCurrencyFromCountry("fr")).toBe("EUR");
      expect(getCurrencyFromCountry("us")).toBe("USD");
    });
  });
});
