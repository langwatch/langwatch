import { describe, expect, it } from "vitest";
import { disambiguateVariantNames } from "../variantDisambiguation";

describe("disambiguateVariantNames", () => {
  describe("given variant names differ", () => {
    it("returns the names unchanged", () => {
      const result = disambiguateVariantNames("Variant A", "Variant B");

      expect(result).toEqual({
        variantAName: "Variant A",
        variantBName: "Variant B",
      });
    });
  });

  describe("given variant names are empty", () => {
    it("returns both empty without appending a suffix", () => {
      const result = disambiguateVariantNames("", "");

      expect(result).toEqual({ variantAName: "", variantBName: "" });
    });
  });

  describe("given variant names collide", () => {
    it("falls back to sequential numbering", () => {
      const result = disambiguateVariantNames(
        "AI search system",
        "AI search system",
      );

      expect(result).toEqual({
        variantAName: "AI search system (1)",
        variantBName: "AI search system (2)",
      });
    });
  });
});
