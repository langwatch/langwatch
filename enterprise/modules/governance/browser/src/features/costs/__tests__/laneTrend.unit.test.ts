// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The change figure on a lane card: later half of the window against the
 * earlier half, and silent whenever the comparison would not be honest.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { describe, expect, it } from "vitest";

import { laneTrendBadge, laneTrendPct } from "../model/cost-lane-format.ts";

const series = (values: readonly (number | null)[]) => values.map((value) => ({ value }));

describe("the lane card's change figure", () => {
  describe("given a series whose later half spends more than its earlier half", () => {
    /** @scenario "A lane card says which way its window is running" */
    it("reports the rise as a percentage of the earlier half", () => {
      const change = laneTrendPct(series([10, 10, 15, 15]));

      expect(change).toBe(50);
      expect(laneTrendBadge(change)).toBe("+50%");
    });
  });

  describe("given fewer periods than the comparison needs", () => {
    /** @scenario "A window too short to compare halves reports no change at all" */
    it("has no change figure and no badge", () => {
      const change = laneTrendPct(series([10, 20, 30]));

      expect(change).toBeNull();
      expect(laneTrendBadge(change)).toBeNull();
    });
  });

  describe("given an odd number of periods that all cost the same", () => {
    /** @scenario "An odd number of periods does not invent a rise out of the split" */
    it("reports level, not the rise an uneven split would produce", () => {
      const change = laneTrendPct(series([7, 7, 7, 7, 7]));

      expect(change).toBe(0);
      expect(laneTrendBadge(change)).toBe("level");
    });
  });

  describe("given a series holding a day the read would not price", () => {
    /** @scenario "A day whose figure is withheld is left out of the change, never counted as zero" */
    it("counts that day toward neither half", () => {
      const withWithheldDay = laneTrendPct(series([10, 10, null, 20, 20]));

      expect(withWithheldDay).toBe(laneTrendPct(series([10, 10, 20, 20])));
      expect(withWithheldDay).toBe(100);
    });
  });
});
