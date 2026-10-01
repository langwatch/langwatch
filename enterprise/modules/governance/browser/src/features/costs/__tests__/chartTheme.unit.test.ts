// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The colours the governance cards draw their marks in: named constants, read
 * as data, so a retheme fails on the family a mark draws from and not on a hex.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { getColorPaletteForString } from "@langwatch/design-system/rotating-colors";
import { describe, expect, it } from "vitest";

import {
  CHART_SEAT_CONTRACT_FILL,
  CHART_SEAT_FILL,
  CHART_SPARK_STROKE,
} from "../model/chart-theme.ts";

const NAMED_MARKS = {
  lane: CHART_SPARK_STROKE,
  seatsAssigned: CHART_SEAT_FILL,
  seatsBought: CHART_SEAT_CONTRACT_FILL,
} as const;

const NEUTRAL_SPREAD = 48;

/** The palette family a colour belongs to: a Chakra token's own name, or neutral for a grey. */
function familyOf(colour: string): string {
  const token = /-colors-([a-z]+)-solid\)$/.exec(colour);
  if (token?.[1]) return token[1];
  const channels = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(colour)?.slice(1);
  if (!channels) throw new Error(`no family for ${colour}`);
  const values = channels.map((channel) => Number.parseInt(channel, 16));
  if (Math.max(...values) - Math.min(...values) < NEUTRAL_SPREAD) return "neutral";
  throw new Error(`no family for ${colour}`);
}

const CHART_PALETTE = new Set(
  Array.from("abcdefghijklmnopqrstuvwxyz").map((letter) => getColorPaletteForString(letter)),
);

describe("the named chart marks", () => {
  describe("when the colour each is drawn with is read", () => {
    /** @scenario "A card's mark is not painted in a direction colour" */
    it("is neither the colour a screen uses for good nor for bad", () => {
      for (const mark of Object.values(NAMED_MARKS)) {
        expect(["green", "red"]).not.toContain(familyOf(mark));
      }
    });

    /** @scenario "A chart's marks are drawn in chart colours, never in text colours" */
    it("is not a text token", () => {
      for (const mark of Object.values(NAMED_MARKS)) {
        expect(mark).not.toMatch(/-colors-fg/);
      }
    });

    /** @scenario "Two marks that mean different things do not share a colour family" */
    it("gives no two marks with different meanings the same family", () => {
      const families = Object.values(NAMED_MARKS).map(familyOf);

      expect(new Set(families).size).toBe(families.length);
    });
  });

  describe("when a sparkline asks for its colour", () => {
    /** @scenario "A single-series mark on a governance card is drawn from the chart palette" */
    it("answers a hue the chart palette holds", () => {
      expect(CHART_PALETTE.has(familyOf(CHART_SPARK_STROKE))).toBe(true);
    });

    /** @scenario "A data mark does not borrow the brand accent reserved for controls" */
    it("is not the accent the pressable controls are painted in", () => {
      const controlAccent = "orange";

      expect(familyOf(CHART_SPARK_STROKE)).not.toBe(controlAccent);
    });
  });
});
