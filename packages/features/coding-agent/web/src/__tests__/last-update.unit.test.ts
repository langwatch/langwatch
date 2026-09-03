/**
 * @vitest-environment node
 * @unit
 *
 * The Last update column: a distance while the row is still warm, a date once
 * it is not.
 */
import { describe, expect, it } from "vitest";

import { formatLastUpdate } from "../last-update";

const NOW = new Date("2026-08-07T12:00:00Z").getTime();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("formatLastUpdate", () => {
  describe("given an update from within the last day", () => {
    /** @scenario "A recent update reads as time ago and an older one as a date" */
    it("reads as a distance", () => {
      expect(formatLastUpdate({ timestampMs: NOW - 3 * HOUR_MS, now: NOW })).toBe("3h ago");
    });

    /** @scenario "A recent update reads as time ago and an older one as a date" */
    it("reads in minutes when it just happened", () => {
      expect(formatLastUpdate({ timestampMs: NOW - 5 * 60 * 1000, now: NOW })).toBe("5m ago");
    });
  });

  describe("given an update older than a day", () => {
    /** @scenario "A recent update reads as time ago and an older one as a date" */
    it("reads as the short date", () => {
      expect(formatLastUpdate({ timestampMs: NOW - 3 * DAY_MS, now: NOW })).toBe("Aug 4");
    });
  });

  describe("given an update from a previous year", () => {
    /** @scenario "A recent update reads as time ago and an older one as a date" */
    it("carries the year, the way the other date columns do", () => {
      expect(
        formatLastUpdate({
          timestampMs: new Date("2025-12-24T12:00:00Z").getTime(),
          now: new Date("2026-01-05T12:00:00Z").getTime(),
        }),
      ).toBe("Dec 24, 2025");
    });
  });

  describe("given a timestamp that is not a date", () => {
    it("formats nothing rather than crashing the row", () => {
      expect(formatLastUpdate({ timestampMs: Number.NaN, now: NOW })).toBe("");
    });
  });
});
