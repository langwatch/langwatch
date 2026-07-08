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

  describe("given variant names collide and models differ", () => {
    it("disambiguates using the model", () => {
      const result = disambiguateVariantNames(
        "AI search system",
        "AI search system",
        "gpt-4.1",
        "gpt-5-mini",
      );

      expect(result).toEqual({
        variantAName: "AI search system (gpt-4.1)",
        variantBName: "AI search system (gpt-5-mini)",
      });
    });
  });

  describe("given variant names collide and models also match", () => {
    it("falls back to sequential numbering", () => {
      const result = disambiguateVariantNames(
        "AI search system",
        "AI search system",
        "gpt-4.1",
        "gpt-4.1",
      );

      expect(result).toEqual({
        variantAName: "AI search system (1)",
        variantBName: "AI search system (2)",
      });
    });
  });

  describe("given variant names collide and models are unknown", () => {
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

  describe("given only one model is known", () => {
    it("falls back to sequential numbering", () => {
      const result = disambiguateVariantNames(
        "AI search system",
        "AI search system",
        "gpt-4.1",
        undefined,
      );

      expect(result).toEqual({
        variantAName: "AI search system (1)",
        variantBName: "AI search system (2)",
      });
    });
  });
});
