/**
 * The one place a pass rate becomes a colour.
 *
 * Thresholds and colours are stated together, so the percentage text and the
 * fill of a trend bar cannot disagree. Two scales that shared a palette and
 * held their own thresholds once made a 95 percent run read amber as text and
 * green as a bar in the same row.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { describe, expect, it } from "vitest";
import {
  formatPassRate,
  PASS_RATE_AMBER_FLOOR,
  passRateBand,
  passRateColor,
} from "../shared/pass-rate-color";

describe("the colour of a pass rate", () => {
  describe("when the same rate is read for the text and for the bar", () => {
    /** @scenario "One helper maps a pass rate to a colour for text and for bars" */
    it("answers one colour, whatever asks for it", () => {
      // The rate that broke the two-scale version: it rounds to 100 in text
      // and sat under the bar's own green floor.
      for (const rate of [null, 0, 39, 40, 95, 99, 99.6, 100]) {
        const text = passRateColor(rate);
        const bar = passRateColor(rate);
        expect(bar).toBe(text);
      }
    });
  });

  describe("when a plan did not pass everything", () => {
    /** @scenario "Green reads at one hundred percent only" */
    it("reads green at one hundred and amber at ninety nine", () => {
      expect(passRateBand(100)).toBe("green");
      expect(passRateBand(99)).toBe("amber");
      expect(passRateColor(99)).not.toBe(passRateColor(100));
    });

    // A rate is drawn rounded, so a colour that disagreed with the number
    // beside it would read as a bug in the row rather than in the scale.
    /** @scenario "Green reads at one hundred percent only" */
    it("reads green for a rate that rounds to one hundred", () => {
      expect(formatPassRate(99.97)).toBe("100%");
      expect(passRateBand(99.97)).toBe("green");
    });
  });

  describe("when the rate is under the amber floor", () => {
    /** @scenario "Amber reads from forty percent and red reads under it" */
    it("reads amber at the floor and red one below it", () => {
      expect(PASS_RATE_AMBER_FLOOR).toBe(40);
      expect(passRateBand(40)).toBe("amber");
      expect(passRateBand(39)).toBe("red");
      expect(passRateBand(0)).toBe("red");
    });
  });

  describe("when nothing settled", () => {
    // Null and zero are different colours on purpose. A run with no verdict
    // yet painted red reads as a run that failed completely.
    /** @scenario "A pass rate that is not known reads grey" */
    it("reads grey rather than red, and shows a dash", () => {
      expect(passRateBand(null)).toBe("none");
      expect(passRateColor(null)).not.toBe(passRateColor(0));
      expect(formatPassRate(null)).toBe("-");
    });
  });
});
