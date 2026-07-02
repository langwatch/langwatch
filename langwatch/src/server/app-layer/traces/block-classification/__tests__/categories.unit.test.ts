import { describe, expect, it } from "vitest";
import { catchAllFor, InputCategory, OutputCategory } from "../categories";

describe("catchAllFor", () => {
  describe("when the axis is input", () => {
    it("returns the input catch-all", () => {
      expect(catchAllFor("input")).toBe(InputCategory.OTHER_INPUT);
    });
  });

  describe("when the axis is output", () => {
    it("returns the output catch-all", () => {
      expect(catchAllFor("output")).toBe(OutputCategory.OTHER_OUTPUT);
    });
  });
});

describe("category taxonomy", () => {
  it("has 12 input-axis and 6 output-axis values with no collisions", () => {
    const input = Object.values(InputCategory);
    const output = Object.values(OutputCategory);
    expect(input).toHaveLength(12);
    expect(output).toHaveLength(6);
    expect(new Set([...input, ...output]).size).toBe(18);
  });
});
