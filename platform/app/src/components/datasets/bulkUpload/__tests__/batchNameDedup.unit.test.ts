import { describe, expect, it } from "vitest";
import { baseNameFromFilename, batchDedupeNames } from "../batchNameDedup";

describe("baseNameFromFilename", () => {
  describe("when the filename has an extension", () => {
    it("strips the extension", () => {
      expect(baseNameFromFilename("products.csv")).toBe("products");
      expect(baseNameFromFilename("a.b.jsonl")).toBe("a.b");
    });
  });

  describe("when the filename has no usable stem", () => {
    it("falls back to a default name", () => {
      expect(baseNameFromFilename(".csv")).toBe("New Dataset");
      expect(baseNameFromFilename("   ")).toBe("New Dataset");
    });
  });
});

describe("batchDedupeNames", () => {
  describe("given files that share a name", () => {
    it("keeps the first and suffixes the rest distinctly", () => {
      expect(batchDedupeNames(["data", "data", "other", "data"])).toEqual([
        "data",
        "data (1)",
        "other",
        "data (2)",
      ]);
    });

    it("never collides a bumped name with a literal input of that suffix", () => {
      expect(batchDedupeNames(["a", "a", "a (1)"])).toEqual([
        "a",
        "a (1)",
        "a (1) (1)",
      ]);
    });
  });

  describe("given all-distinct names", () => {
    it("returns them unchanged", () => {
      expect(batchDedupeNames(["x", "y", "z"])).toEqual(["x", "y", "z"]);
    });
  });
});
