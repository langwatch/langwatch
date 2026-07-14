import { describe, expect, it } from "vitest";
import { disambiguateNames } from "../variantDisambiguation";

describe("disambiguateNames", () => {
  describe("given every name differs", () => {
    it("returns the names unchanged", () => {
      expect(disambiguateNames(["Variant A", "Variant B"])).toEqual([
        "Variant A",
        "Variant B",
      ]);
    });
  });

  describe("given names are empty", () => {
    it("returns them empty without appending a suffix", () => {
      expect(disambiguateNames(["", ""])).toEqual(["", ""]);
    });
  });

  describe("given two names collide", () => {
    it("falls back to sequential numbering", () => {
      expect(
        disambiguateNames(["AI search system", "AI search system"]),
      ).toEqual(["AI search system (1)", "AI search system (2)"]);
    });
  });

  describe("given three names collide", () => {
    it("numbers all three in variant order", () => {
      expect(disambiguateNames(["bot", "bot", "bot"])).toEqual([
        "bot (1)",
        "bot (2)",
        "bot (3)",
      ]);
    });
  });

  describe("given only some names collide", () => {
    it("numbers the colliding names and leaves the unique one alone", () => {
      expect(disambiguateNames(["bot", "helper", "bot"])).toEqual([
        "bot (1)",
        "helper",
        "bot (2)",
      ]);
    });
  });
});
