import { describe, expect, it } from "vitest";

import { formatScore } from "../src/metric-value-formatters.ts";

describe("formatScore", () => {
  describe.each([
    ["absent", null, "-"],
    ["zero", 0, "0.00"],
    ["a fraction", 0.5, "0.50"],
  ])("given a score that is %s", (_name, value, rendered) => {
    /** @scenario "The shared score formatter distinguishes absent from zero" */
    it(`formats it as ${rendered}`, () => {
      expect(formatScore(value)).toBe(rendered);
    });
  });
});
