import { describe, expect, it } from "vitest";
import { disambiguateVariantNames } from "../variantDisambiguation";

describe("disambiguateVariantNames", () => {
  describe("given variant names differ", () => {
    it("returns the names unchanged", () => {
      const result = disambiguateVariantNames({
        variantAName: "Variant A",
        variantBName: "Variant B",
      });

      expect(result).toEqual({
        variantAName: "Variant A",
        variantBName: "Variant B",
      });
    });
  });

  describe("given variant names are empty", () => {
    it("returns both empty without appending a suffix", () => {
      const result = disambiguateVariantNames({
        variantAName: "",
        variantBName: "",
      });

      expect(result).toEqual({ variantAName: "", variantBName: "" });
    });
  });

  describe("given variant names collide", () => {
    it("falls back to sequential numbering", () => {
      const result = disambiguateVariantNames({
        variantAName: "AI search system",
        variantBName: "AI search system",
      });

      expect(result).toEqual({
        variantAName: "AI search system (1)",
        variantBName: "AI search system (2)",
      });
    });
  });
});
