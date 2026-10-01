import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { lastUsedLabel } from "../model/last-used.ts";

const NOW = Temporal.Instant.from("2026-08-25T12:00:00.000Z");

const daysBefore = (days: number) => NOW.subtract({ hours: days * 24 }).toString();

describe("given a sign-in method's last use", () => {
  describe("when it was used recently", () => {
    it("says so in relative terms", () => {
      expect(lastUsedLabel({ isoTimestamp: daysBefore(0), now: NOW })).toBe("Last used today");
      expect(lastUsedLabel({ isoTimestamp: daysBefore(1), now: NOW })).toBe("Last used yesterday");
      expect(lastUsedLabel({ isoTimestamp: daysBefore(9), now: NOW })).toBe("Last used 9 days ago");
    });
  });

  describe("when it was used long ago", () => {
    it("gives a date", () => {
      expect(lastUsedLabel({ isoTimestamp: daysBefore(400), now: NOW })).toMatch(
        /Last used .*2025/,
      );
    });
  });

  describe("when no session we hold names it", () => {
    it("says nothing rather than claiming it was never used", () => {
      expect(lastUsedLabel({ isoTimestamp: null, now: NOW })).toBeUndefined();
      expect(lastUsedLabel({ isoTimestamp: void 0, now: NOW })).toBeUndefined();
      expect(lastUsedLabel({ isoTimestamp: "not-a-timestamp", now: NOW })).toBeUndefined();
    });
  });

  describe("when a clock is skewed into the future", () => {
    it("reads as today", () => {
      const ahead = NOW.add({ minutes: 1 }).toString();
      expect(lastUsedLabel({ isoTimestamp: ahead, now: NOW })).toBe("Last used today");
    });
  });
});
