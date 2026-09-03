/**
 * Schema-error selection must rank by JSON Pointer DEPTH, not by the character
 * length of the pointer string.
 *
 * `instancePath` is a string. Ranking it with `.length` scores a shallow error
 * on a long-named property above a genuinely nested one, and the filter that
 * follows then drops the nested error entirely — so the reader is told the
 * wrong thing is wrong.
 *
 * The fixture below is chosen so the two rankings disagree:
 *
 *   /description   → 12 characters, 1 pointer segment deep
 *   /encoding/x    → 11 characters, 2 pointer segments deep
 *
 * Ranking by characters keeps `/description` and discards `/encoding/x`.
 * Ranking by depth keeps `/encoding/x`, which is the specific failure.
 */

import { describe, expect, it } from "vitest";

import { validateAgainstVegaLiteSchema } from "../vega-lite-schema";

/**
 * `description` must be a string (shallow failure, long pointer) and the `x`
 * channel carries an unknown property (deeper failure, shorter pointer).
 */
const SPEC_WITH_SHALLOW_LONG_AND_DEEP_SHORT_ERRORS = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  data: { values: [] },
  mark: "point",
  description: 12345,
  encoding: { x: { field: "a", type: "quantitative", zz: 1 } },
} satisfies Record<string, unknown>;

describe("validateAgainstVegaLiteSchema error selection", () => {
  it("reports the deeper failure even when a shallower pointer has more characters", () => {
    const errors = validateAgainstVegaLiteSchema(SPEC_WITH_SHALLOW_LONG_AND_DEEP_SHORT_ERRORS);
    const paths = errors.map((error) => error.path);

    expect(paths).toContain("/encoding/x");
    expect(paths).not.toContain("/description");
  });
});
