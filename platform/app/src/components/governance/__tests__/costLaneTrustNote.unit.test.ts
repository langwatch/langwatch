/**
 * @vitest-environment node
 *
 * The words a customer reads when a cost day has already changed, or can still
 * change (ADR-128 §15).
 *
 * The two facts are orthogonal and the common case is both, so the interesting
 * cases here are the combinations rather than either one alone.
 *
 * Spec: specs/governance/governance-cost-restatement-markers.feature
 */
import { describe, expect, it } from "vitest";

import { dayTrustNote, restatementNote } from "../costLaneFormat";

describe("dayTrustNote", () => {
  describe("given a day that is neither revised nor still settling", () => {
    it("says nothing at all", () => {
      // An unmarked day is the quiet default. A note on every cell teaches a
      // reader to stop seeing them, which costs the marked days their meaning.
      expect(
        dayTrustNote({ revised: false, previousUsd: null, provisional: false }),
      ).toBeNull();
    });
  });

  describe("given a day that was revised and can still change", () => {
    /** @scenario "A day that was revised and can still change says both" */
    it("names the earlier amount and warns it is not final", () => {
      expect(
        dayTrustNote({ revised: true, previousUsd: 12.5, provisional: true }),
      ).toBe("Revised, was $12.50 — may still change.");
    });
  });

  describe("given a day that was revised and has settled", () => {
    /** @scenario "A restated day shows what it was before" */
    it("names the earlier amount without promising more movement", () => {
      expect(
        dayTrustNote({ revised: true, previousUsd: 12.5, provisional: false }),
      ).toBe("Revised, was $12.50.");
    });
  });

  describe("given a day only inside its settling window", () => {
    /** @scenario "A day a pull touched recently can still change" */
    it("says it may change without claiming it already has", () => {
      expect(
        dayTrustNote({ revised: false, previousUsd: null, provisional: true }),
      ).toBe("This day may still change — the provider can still restate it.");
    });
  });

  describe("given a revised day whose earlier amount cannot be stated", () => {
    /** @scenario "A revised day whose earlier figure cannot be stated in dollars withholds it" */
    it("says the day changed without naming a figure", () => {
      const note = dayTrustNote({
        revised: true,
        previousUsd: null,
        provisional: false,
      });

      expect(note).toBe("Revised since it was first reported.");
      // Not an em dash standing in for the amount: a placeholder where a
      // number belongs reads as a number we lost rather than one we withheld.
      expect(note).not.toContain("$");
    });
  });
});

describe("restatementNote", () => {
  describe("given one day of each kind", () => {
    it("reads as a sentence rather than a pair of counts", () => {
      expect(restatementNote({ revisedDays: 1, provisionalDays: 1 })).toBe(
        "1 day in this window has been revised by the provider since first reported, and 1 day can still change while the provider settles it. Hover a day to see which.",
      );
    });
  });

  describe("given several days of each kind", () => {
    it("agrees with itself in the plural", () => {
      expect(restatementNote({ revisedDays: 3, provisionalDays: 12 })).toBe(
        "3 days in this window have been revised by the provider since first reported, and 12 days can still change while the provider settles them. Hover a day to see which.",
      );
    });
  });

  describe("given only settling days", () => {
    it("leaves out the clause it has nothing to say about", () => {
      expect(restatementNote({ revisedDays: 0, provisionalDays: 4 })).toBe(
        "4 days can still change while the provider settles them. Hover a day to see which.",
      );
    });
  });
});
