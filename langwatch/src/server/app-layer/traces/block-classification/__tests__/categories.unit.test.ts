import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  catchAllFor,
  categoryLabel,
  InputCategory,
  OutputCategory,
} from "../categories";

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

describe("InputCategory and OutputCategory", () => {
  it("has 12 input-axis and 6 output-axis values with no collisions", () => {
    const input = Object.values(InputCategory);
    const output = Object.values(OutputCategory);
    expect(input).toHaveLength(12);
    expect(output).toHaveLength(6);
    expect(new Set([...input, ...output]).size).toBe(18);
  });
});

describe("CATEGORIES and CATEGORY_LABELS", () => {
  const allValues = [
    ...Object.values(InputCategory),
    ...Object.values(OutputCategory),
  ];

  it("lists every enum value in CATEGORIES exactly once", () => {
    expect([...CATEGORIES].sort()).toEqual([...allValues].sort());
    expect(CATEGORIES).toHaveLength(18);
  });

  it("maps every category to a human label distinct from its wire value", () => {
    for (const category of allValues) {
      const label = CATEGORY_LABELS[category];
      expect(label).toBeTruthy();
      expect(label).not.toBe(category);
      expect(categoryLabel(category)).toBe(label);
    }
  });
});
