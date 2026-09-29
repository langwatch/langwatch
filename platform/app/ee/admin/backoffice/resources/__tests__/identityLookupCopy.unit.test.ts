/**
 * The words and derivations the operator identity lookup renders.
 *
 * Corresponds to specs/identity/platform-ops-identity-lookup.feature.
 */
import { describe, expect, it } from "vitest";
import {
  repairConfirmationTitle,
  repairTargetIsNameable,
  shortenIdentifier,
  waitedFor,
} from "../identityLookupCopy";

describe("given an identifier that has to be shown", () => {
  describe("when it is rendered", () => {
    /** @scenario "People and organizations are shown by name, never by identifier alone" */
    it("shortens it in the middle and keeps both ends", () => {
      const id = "org_LVYcVYGW1AJqvp2G8vcVd";
      const shortened = shortenIdentifier(id);

      // The middle goes, not the tail: the prefix says what kind of thing it
      // is and the suffix is what tells two of them apart in a log line.
      expect(shortened).toContain("…");
      expect(shortened.startsWith(id.slice(0, 8))).toBe(true);
      expect(shortened.endsWith(id.slice(-4))).toBe(true);
      expect(shortened.length).toBeLessThan(id.length);
    });

    it("leaves a short one alone", () => {
      expect(shortenIdentifier("org_acme")).toBe("org_acme");
    });
  });
});

describe("given a repair an operator is about to run", () => {
  describe("when the target can be named", () => {
    /** @scenario "Every repair names the organization it lands on before it runs" */
    it("offers it, and the confirmation names the organization and the person", () => {
      expect(
        repairTargetIsNameable({
          organizationName: "Acme",
          personName: "Sam",
        }),
      ).toBe(true);
      expect(
        repairConfirmationTitle({
          verb: "Remove a sign-in method",
          personName: "Sam",
          organizationName: "Acme",
        }),
      ).toBe("Remove a sign-in method for Sam at Acme?");
    });
  });

  describe("when the organization behind the result cannot be named", () => {
    /** @scenario "A repair whose target cannot be named is withheld rather than confirmed" */
    it("withholds the repair rather than confirming against an identifier", () => {
      // On a cross-organization surface the risk is not the wrong action, it
      // is the right action on the wrong tenant.
      expect(
        repairTargetIsNameable({ organizationName: null, personName: "Sam" }),
      ).toBe(false);
      expect(
        repairTargetIsNameable({ organizationName: "Acme", personName: null }),
      ).toBe(false);
    });
  });
});

describe("given something that has been waiting", () => {
  const NOW = 1_700_000_000_000;
  const MINUTE = 60_000;

  describe("when the queue says how long", () => {
    it("uses the largest unit that still says something", () => {
      expect(waitedFor({ sinceMs: NOW - 30_000, nowMs: NOW })).toBe("just now");
      expect(waitedFor({ sinceMs: NOW - MINUTE, nowMs: NOW })).toBe("1 minute");
      expect(waitedFor({ sinceMs: NOW - 90 * MINUTE, nowMs: NOW })).toBe(
        "1 hour",
      );
      expect(
        waitedFor({ sinceMs: NOW - 9 * 24 * 60 * MINUTE, nowMs: NOW }),
      ).toBe("9 days");
    });

    it("never counts backwards from a clock that disagrees", () => {
      expect(waitedFor({ sinceMs: NOW + MINUTE, nowMs: NOW })).toBe("just now");
    });
  });
});
