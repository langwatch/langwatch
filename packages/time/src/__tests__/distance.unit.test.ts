import { describe, expect, it } from "vitest";

import {
  formatDistance,
  formatDistanceCompact,
  formatDistanceStrict,
  formatDistanceToNow,
} from "../distance.ts";

const AMSTERDAM = "Europe/Amsterdam";
const NOW = new Date("2026-06-15T12:00:00+02:00");

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (ms: number) => new Date(NOW.getTime() - ms);

/** The ten fixtures the screens are read against, with the words they printed before. */
const ROUNDED: [label: string, ms: number, expected: string][] = [
  ["thirty seconds", 30 * SECOND, "1 minute ago"],
  ["twelve minutes", 12 * MINUTE, "12 minutes ago"],
  ["one hour", HOUR, "about 1 hour ago"],
  ["five hours", 5 * HOUR, "about 5 hours ago"],
  ["one day", DAY, "1 day ago"],
  ["three days", 3 * DAY, "3 days ago"],
  ["ten days", 10 * DAY, "10 days ago"],
  ["forty days", 40 * DAY, "about 1 month ago"],
  ["six months", 182 * DAY, "6 months ago"],
  ["two years", 730 * DAY, "about 2 years ago"],
];

const STRICT: [label: string, ms: number, expected: string][] = [
  ["thirty seconds", 30 * SECOND, "30 seconds ago"],
  ["twelve minutes", 12 * MINUTE, "12 minutes ago"],
  ["one hour", HOUR, "1 hour ago"],
  ["five hours", 5 * HOUR, "5 hours ago"],
  ["one day", DAY, "1 day ago"],
  ["three days", 3 * DAY, "3 days ago"],
  ["ten days", 10 * DAY, "10 days ago"],
  ["forty days", 40 * DAY, "1 month ago"],
  ["six months", 182 * DAY, "6 months ago"],
  ["two years", 730 * DAY, "2 years ago"],
];

describe("formatDistance", () => {
  describe("given the ten fixtures the product prints", () => {
    /** @scenario "The relative-time ladder prints the same words" */
    it.each(ROUNDED)("says %s as %s", (_label, ms, expected) => {
      expect(formatDistance(ago(ms), NOW, { addSuffix: true, timeZone: AMSTERDAM })).toBe(expected);
    });
  });

  describe("given the thresholds either side of each rung", () => {
    it("keeps the boundaries the wording has always had", () => {
      const at = (ms: number) =>
        formatDistance(ago(ms), NOW, { addSuffix: true, timeZone: AMSTERDAM });
      expect(at(29 * SECOND)).toBe("less than a minute ago");
      expect(at(45 * MINUTE)).toBe("about 1 hour ago");
      expect(at(100 * MINUTE)).toBe("about 2 hours ago");
      expect(at(36 * HOUR)).toBe("1 day ago");
    });
  });

  describe("given a moment still to come", () => {
    /** @scenario "A future timestamp still reads as a wait rather than a memory" */
    it("reads as a wait rather than a memory", () => {
      expect(
        formatDistance(new Date(NOW.getTime() + 12 * MINUTE), NOW, {
          addSuffix: true,
          timeZone: AMSTERDAM,
        }),
      ).toBe("in 12 minutes");
    });
  });

  describe("given no suffix is asked for", () => {
    it("says the span alone", () => {
      expect(formatDistance(ago(12 * MINUTE), NOW, { timeZone: AMSTERDAM })).toBe("12 minutes");
    });
  });

  describe("given a span crossing a daylight-saving change", () => {
    it("counts the days a reader counted, not the hours a clock counted", () => {
      const before = new Date("2026-03-28T12:00:00+01:00");
      const after = new Date("2026-03-30T12:00:00+02:00");
      expect(formatDistance(before, after, { addSuffix: true, timeZone: AMSTERDAM })).toBe(
        "2 days ago",
      );
    });
  });
});

describe("formatDistanceToNow", () => {
  describe("given a moment twelve minutes back", () => {
    it("reads against the current clock", () => {
      expect(formatDistanceToNow(Date.now() - 12 * MINUTE, { addSuffix: true })).toBe(
        "12 minutes ago",
      );
    });
  });
});

describe("formatDistanceStrict", () => {
  describe("given the ten fixtures the product prints", () => {
    it.each(STRICT)("says %s as %s", (_label, ms, expected) => {
      expect(formatDistanceStrict(ago(ms), NOW, { addSuffix: true, timeZone: AMSTERDAM })).toBe(
        expected,
      );
    });
  });

  describe("given a moment still to come", () => {
    it("reads as a wait", () => {
      expect(
        formatDistanceStrict(new Date(NOW.getTime() + 3 * HOUR), NOW, {
          addSuffix: true,
          timeZone: AMSTERDAM,
        }),
      ).toBe("in 3 hours");
    });
  });
});

const COMPACT: [label: string, earlier: Date, expected: string][] = [
  ["ten seconds", ago(10 * SECOND), "now"],
  ["five minutes", ago(5 * MINUTE), "5m ago"],
  ["three hours", ago(3 * HOUR), "3h ago"],
  ["two days", ago(2 * DAY), "2d ago"],
  ["one week", ago(7 * DAY), "1w ago"],
  ["three months", new Date("2026-03-15T12:00:00+01:00"), "3mo ago"],
];

describe("formatDistanceCompact", () => {
  describe("given timestamps across the minute, hour, day, week and month thresholds", () => {
    /** @scenario "The compact ladder a table row prints is unchanged" */
    it.each(COMPACT)("reads %s as %s", (_label, earlier, expected) => {
      expect(formatDistanceCompact(NOW, earlier, { timeZone: AMSTERDAM })).toBe(expected);
    });
  });
});
