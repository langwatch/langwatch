import { describe, expect, it } from "vitest";

import { spentSubline } from "../spentSubline";

describe("spentSubline", () => {
  describe("when part of the month's spend is bundled", () => {
    /** @scenario The spend card reports the bundled portion, never a budget */
    it("reports the bundled amount", () => {
      expect(spentSubline({ bundledUsd: 50701.19 })).toBe("$50701.19 bundled");
    });
  });

  describe("when nothing is bundled", () => {
    it("says nothing rather than reserving a blank line", () => {
      expect(spentSubline({ bundledUsd: 0 })).toBe("");
    });
  });

  describe("when the organization has an AI-Gateway budget", () => {
    // The regression this pins: the card used to append "of $100.00 budget"
    // from `user.personalBudget`, which resolves the gateway budget covering
    // virtual-key traffic. That ledger is not the tool spend this card totals,
    // so the figure read as a cap on usage it never governs. No budget input
    // reaches this function at all, which is the point.
    /** @scenario The spend card reports the bundled portion, never a budget */
    it("still says nothing about a budget", () => {
      expect(spentSubline({ bundledUsd: 12.5 })).not.toContain("budget");
    });
  });
});
