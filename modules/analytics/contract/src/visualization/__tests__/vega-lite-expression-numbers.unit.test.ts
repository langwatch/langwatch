/**
 * Numeric literals in scientific notation should be accepted, while hex stays
 * refused (Vega doesn't support it). Node environment on purpose — see
 * `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { screenVegaExpression } from "../vega-lite-expressions.ts";

describe("numeric literals", () => {
  it("accepts scientific notation", () => {
    expect(screenVegaExpression("datum.value > 1e6").forbiddenIdentifiers).toEqual([]);
  });

  it("accepts the uppercase, signed and fractional exponent forms", () => {
    for (const expression of [
      "datum.value > 1E6",
      "datum.value > 1e+6",
      "datum.value > 2.5e-3",
      "datum.value > .5",
      "datum.value > 1000",
    ]) {
      expect({
        expression,
        forbidden: screenVegaExpression(expression).forbiddenIdentifiers,
      }).toEqual({ expression, forbidden: [] });
    }
  });

  it("keeps refusing hex literals, which Vega cannot parse", () => {
    expect(screenVegaExpression("datum.value > 0x1f").forbiddenIdentifiers).toContain("x1f");
  });

  it("leaves an identifier that contains a digit intact", () => {
    expect(screenVegaExpression("value1 > 2").forbiddenIdentifiers).toEqual(["value1"]);
  });
});
