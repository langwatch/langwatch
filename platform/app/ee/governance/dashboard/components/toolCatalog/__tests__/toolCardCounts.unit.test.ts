// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * How a catalog card shortens a count.
 *
 * The rule is a threshold, not a per-row decision, so it is worth pinning on
 * its own: the same function decides for token counts, event counts and
 * conversation counts, and the boundary is the only interesting thing about it.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
import { describe, expect, it } from "vitest";

import {
  exactCardCount,
  formatCardCount,
  SAMPLE_TOOL_CARDS,
} from "../toolCards";

describe("a count on a catalog card", () => {
  describe("when it runs to nine digits", () => {
    /** @scenario "A count of a million or more is shortened on the card" */
    it("is shortened to one decimal place", () => {
      expect(formatCardCount(412_900_000)).toBe("412.9M");
      expect(formatCardCount(204_100_000)).toBe("204.1M");
      expect(formatCardCount(31_200_000)).toBe("31.2M");
    });
  });

  describe("when it is smaller than a million", () => {
    /** @scenario "A count below a million is left exact and grouped" */
    it("keeps every digit, grouped", () => {
      expect(formatCardCount(22_180)).toBe("22,180");
      expect(formatCardCount(8_412)).toBe("8,412");
      expect(formatCardCount(12)).toBe("12");
    });
  });

  describe("at the boundary", () => {
    /** @scenario "A count of a million or more is shortened on the card" */
    it("shortens from one million and not before", () => {
      expect(formatCardCount(999_999)).toBe("999,999");
      expect(formatCardCount(1_000_000)).toBe("1M");
    });
  });

  describe("whatever the card shows", () => {
    /** @scenario "A shortened count keeps its exact value on hover" */
    it("can still be read in full", () => {
      // The shortened form is a reading aid. The exact figure is what the
      // hover and the accessible name carry, so nothing is lost by rounding.
      expect(exactCardCount(412_900_000)).toBe("412,900,000");
      expect(exactCardCount(8_412)).toBe("8,412");
    });
  });

  describe("across the sample catalog", () => {
    /** @scenario "A shortened count keeps its exact value on hover" */
    it("stores every count as a number rather than a formatted string", () => {
      // The type is what keeps money out of the compacting path, so a sample
      // card that slipped a pre-formatted count in would quietly opt out of
      // the rule. Cheaper to catch here than to spot on a screenshot.
      const counted = [
        "eventsLast24Hours",
        "agents",
        "tokens30Days",
        "conversations30Days",
      ] as const;

      for (const card of SAMPLE_TOOL_CARDS) {
        for (const row of counted) {
          const value = card.values[row];
          if (value !== undefined) expect(typeof value).toBe("number");
        }
      }
    });
  });
});
