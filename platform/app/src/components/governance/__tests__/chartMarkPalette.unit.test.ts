import { describe, expect, it } from "vitest";

import { rotatingColors } from "../../../utils/rotatingColors";
import { CHART_SEAT_FILL, CHART_SPARK_STROKE } from "../chartTheme";

/**
 * Which FAMILY a mark draws from is settled next door, in
 * chartMarkTokens.unit.test.ts: not the ink family. This file settles the
 * question that one leaves open — which colour family it should be instead,
 * and which one it must not be even though that one is the product's own.
 *
 * The rule is in specs/ai-governance/dashboard/governance-ui-controls.feature
 * under "Colour on a card", not in a comment here, because the People and
 * Inventory pages will add cards with marks on them and cannot read this file.
 *
 * No hex is pinned. Both assertions read the palette at run time, so a
 * retheme moves the test with the product instead of failing it.
 */

/** `var(--chakra-colors-blue-solid)` → `blue`. Null if it is not a token. */
function colourFamilyOf(token: string): string | null {
  return /--chakra-colors-([a-z]+)-/.exec(token)?.[1] ?? null;
}

/**
 * The palette names, read from the rotation itself rather than copied. This is
 * the same projection `rotatingColors.ts` makes internally to key its chart
 * hexes, so a hue added to the rotation is a hue this test will accept.
 */
const PALETTE_FAMILIES = new Set(
  rotatingColors.colors.map((entry) => entry.background.split(".")[0]!),
);

/**
 * The accent the pressable controls wear. Named here rather than imported
 * because it lives in the theme config inside `_app.tsx`, which drags a page's
 * worth of imports into a unit test. The membership assertion below is what
 * keeps the literal honest.
 */
const BRAND_ACCENT_FAMILY = "orange";

describe("a governance card's mark draws from the chart palette", () => {
  /** @scenario "A single-series mark on a governance card is drawn from the chart palette" */
  it("draws the lane sparkline in a hue the palette holds", () => {
    const family = colourFamilyOf(CHART_SPARK_STROKE);

    expect(family).not.toBeNull();
    expect(PALETTE_FAMILIES).toContain(family);
  });

  /** @scenario "A data mark does not borrow the brand accent reserved for controls" */
  it("leaves the accent the controls are painted in to the controls", () => {
    // Asserted first so the comparison below is against a real palette member.
    // Without it, a typo'd accent name would make the next line pass on a
    // family that does not exist.
    expect(PALETTE_FAMILIES).toContain(BRAND_ACCENT_FAMILY);

    expect(colourFamilyOf(CHART_SPARK_STROKE)).not.toBe(BRAND_ACCENT_FAMILY);
  });
});

/**
 * The marks this screen NAMES, each against what it means to a reader.
 *
 * Keyed by the meaning rather than the constant, because the meaning is what
 * has to be unique — two constants holding one hue is only a defect when they
 * say different things, and two constants deliberately sharing a hue is not a
 * defect at all.
 *
 * `CHART_SEAT_CONTRACT` is deliberately absent. It is a slate ink shared on
 * purpose with the forecast's projection, and both mean the same thing: a
 * quantity that is not a measurement. Adding it here would assert the opposite
 * of the rule it follows.
 */
const MARK_MEANINGS: Record<string, string> = {
  "one measured series with no name to hash": CHART_SPARK_STROKE,
  "seats somebody is sitting in": CHART_SEAT_FILL,
};

describe("marks that mean different things are told apart", () => {
  /** @scenario "Two marks that mean different things do not share a colour family" */
  it("gives each named meaning a family of its own", () => {
    const families = Object.entries(MARK_MEANINGS).map(([meaning, token]) => {
      const family = colourFamilyOf(token);
      // Named in the assertion so a failure says which mark went off-palette,
      // rather than reporting a set one short and leaving the reader to find
      // out which of them it was.
      expect(family, `${meaning} draws in ${token}`).not.toBeNull();
      expect(PALETTE_FAMILIES, `${meaning} draws in ${token}`).toContain(
        family,
      );
      return family;
    });

    // The whole rule, in one line: as many families as there are meanings.
    // Shades of one family do not count as told apart — #2563eb beside #3182ce
    // is what this is here to stop, and both of those are "blue".
    expect(new Set(families).size).toBe(families.length);
  });
});
