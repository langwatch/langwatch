import { describe, expect, it } from "vitest";
import {
  generateUniqueIdentifier,
  normalizeIdentifier,
} from "../identifierUtils";

describe("normalizeIdentifier", () => {
  it("replaces spaces with underscores", () => {
    expect(normalizeIdentifier("my variable")).toBe("my_variable");
  });

  it("removes dashes", () => {
    expect(normalizeIdentifier("my-custom-score")).toBe("mycustomscore");
  });

  it("removes special characters", () => {
    expect(normalizeIdentifier("my@score!test#123")).toBe("myscoretest123");
  });

  it("lowercases the result", () => {
    expect(normalizeIdentifier("MyVariable")).toBe("myvariable");
  });

  it("preserves underscores", () => {
    expect(normalizeIdentifier("my_custom_score")).toBe("my_custom_score");
  });

  it("handles mixed cases", () => {
    expect(normalizeIdentifier("My Variable Name!")).toBe("my_variable_name");
  });

  it("handles empty string", () => {
    expect(normalizeIdentifier("")).toBe("");
  });

  it("handles string with only special characters", () => {
    expect(normalizeIdentifier("@#$%")).toBe("");
  });
});

describe("generateUniqueIdentifier", () => {
  it("returns baseName if not in existing identifiers", () => {
    expect(generateUniqueIdentifier("output", ["input", "other"])).toBe(
      "output",
    );
  });

  it("returns baseName_1 if baseName exists", () => {
    expect(generateUniqueIdentifier("output", ["output", "other"])).toBe(
      "output_1",
    );
  });

  it("returns baseName_2 if baseName and baseName_1 exist", () => {
    expect(
      generateUniqueIdentifier("output", ["output", "output_1", "other"]),
    ).toBe("output_2");
  });

  it("finds next available number in sequence", () => {
    expect(
      generateUniqueIdentifier("var", ["var", "var_1", "var_2", "var_3"]),
    ).toBe("var_4");
  });

  it("handles empty existing identifiers", () => {
    expect(generateUniqueIdentifier("output", [])).toBe("output");
  });
});
