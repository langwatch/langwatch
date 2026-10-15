/**
 * Rank schema errors by JSON Pointer depth, not character length, so shallow
 * errors on long-named properties don't hide genuinely nested errors. Example:
 * /description (12 chars, 1 segment) vs /encoding/x (11 chars, 2 segments) — depth wins.
 */

import { describe, expect, it } from "vitest";

import { validateAgainstVegaLiteSchema } from "../vega-lite-schema.ts";

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
