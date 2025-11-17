import { describe, expect, it } from "vitest";

import { generateUniqueIdentifier } from "../identifierUtils";

describe("generateUniqueIdentifier", () => {
  describe("when no existing identifiers", () => {
    it("returns the base name", () => {
      const result = generateUniqueIdentifier({
        baseName: "input",
        existingIdentifiers: [],
      });

      expect(result).toBe("input");
    });
  });

  describe("when base name exists", () => {
    it("appends _1 suffix", () => {
      const result = generateUniqueIdentifier({
        baseName: "input",
        existingIdentifiers: ["input"],
      });

      expect(result).toBe("input_1");
    });
  });

  describe("when base name and _1 exist", () => {
    it("appends _2 suffix", () => {
      const result = generateUniqueIdentifier({
        baseName: "input",
        existingIdentifiers: ["input", "input_1"],
      });

      expect(result).toBe("input_2");
    });
  });

  describe("when multiple sequential identifiers exist", () => {
    it("finds the next available number", () => {
      const result = generateUniqueIdentifier({
        baseName: "output",
        existingIdentifiers: ["output", "output_1", "output_2", "output_3"],
      });

      expect(result).toBe("output_4");
    });
  });
});
