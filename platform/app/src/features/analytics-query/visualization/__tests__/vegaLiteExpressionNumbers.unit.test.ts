/**
 * Numbers are not identifiers.
 *
 * The screen finds identifiers by scanning what is left after strings and
 * member access are removed. A numeric literal in scientific notation carries
 * letters — `1e6` — and a scan that does not know it is looking at a number
 * reads the tail as the identifier `e6` and refuses a comparison Vega runs
 * perfectly well. That is a false refusal, and the user sees it as the product
 * rejecting valid arithmetic.
 *
 * Hex is the other half of the pair and must stay refused. Vega's expression
 * language has no hex literal, so `0x1f` is not a number Vega understands; the
 * screen should keep reporting it rather than quietly accept a form the
 * evaluator will not parse. Stripping decimal and exponent forms only — never
 * hex — is what keeps both halves true at once.
 *
 * The last test is the guard on the stripping itself: an identifier that merely
 * contains a digit is not a literal, and must survive the scan intact and be
 * reported under its own name.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { screenVegaExpression } from "../vegaLiteExpressions";

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
    expect(screenVegaExpression("datum.value > 0x1f").forbiddenIdentifiers).toContain(
      "x1f",
    );
  });

  it("leaves an identifier that contains a digit intact", () => {
    expect(screenVegaExpression("value1 > 2").forbiddenIdentifiers).toEqual(["value1"]);
  });
});
