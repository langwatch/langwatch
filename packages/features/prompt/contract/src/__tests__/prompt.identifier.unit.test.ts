import { describe, expect, it } from "vitest";

import { generateUniqueIdentifier, normalizeIdentifier } from "../prompt.identifier";

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

describe("normalizeIdentifier", () => {
  describe("when the value carries spaces", () => {
    it("replaces them with underscores", () => {
      expect(normalizeIdentifier("my variable")).toBe("my_variable");
    });
  });

  describe("when the value carries punctuation", () => {
    it("drops dashes", () => {
      expect(normalizeIdentifier("my-custom-score")).toBe("mycustomscore");
    });

    it("drops every other special character", () => {
      expect(normalizeIdentifier("my@score!test#123")).toBe("myscoretest123");
    });

    it("keeps underscores", () => {
      expect(normalizeIdentifier("my_custom_score")).toBe("my_custom_score");
    });

    it("returns an empty identifier when nothing survives", () => {
      expect(normalizeIdentifier("@#$%")).toBe("");
    });
  });

  describe("when the value carries capitals", () => {
    it("lower-cases the result", () => {
      expect(normalizeIdentifier("MyVariable")).toBe("myvariable");
    });

    it("normalizes spaces, punctuation and case together", () => {
      expect(normalizeIdentifier("My Variable Name!")).toBe("my_variable_name");
    });
  });

  describe("when the value is empty", () => {
    it("returns an empty identifier", () => {
      expect(normalizeIdentifier("")).toBe("");
    });
  });
});
