// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The extremes of a pulled page's times, past the size `Math.min(...values)` can spread.
 * `pullReadThrough` reads its newest stamp through `latestOf`.
 *
 * Spec: enterprise/modules/governance/specs/ocsf-event-pages.feature
 */
import { describe, expect, it } from "vitest";

import { earliestOf, latestOf } from "../page-extremes.rules.ts";

describe("the extremes of a pulled page", () => {
  describe("given 200,000 times, past Node's spread limit", () => {
    const times = Array.from(
      { length: 200_000 },
      (_, index) => 1_000_000 + ((index * 7) % 200_000),
    );

    /** @scenario "A pulled page too large to spread into Math.min still finds its unpriced window" */
    it("finds the earliest and the latest without a RangeError", () => {
      expect(earliestOf(times)).toBe(1_000_000);
      expect(latestOf(times)).toBe(1_199_999);
    });
  });

  describe("given an empty page", () => {
    it("answers the identities a caller must guard against", () => {
      expect(earliestOf([])).toBe(Infinity);
      expect(latestOf([])).toBe(-Infinity);
    });
  });
});
