/**
 * The stamps on the CLI's chronological listings, read from a timezone that is
 * not UTC, which is where the bug this pins actually shows up: a UTC clock
 * printed without a marker is indistinguishable from the reader's own.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clockTime, dayHeading, localDay } from "../event-clock";

/** 00:30:05 on 4 July in Amsterdam, 22:30:05 on 3 July in UTC. */
const LATE_EVENING_UTC = Date.parse("2024-07-03T22:30:05Z");
const EARLY_EVENING_UTC = Date.parse("2024-07-03T17:04:09Z");

const originalTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Europe/Amsterdam";
});

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("clockTime", () => {
  describe("given an instant and a reader two hours ahead of UTC", () => {
    it("renders the reader's own clock rather than UTC", () => {
      expect(clockTime(LATE_EVENING_UTC)).toBe("00:30:05");
      expect(clockTime(EARLY_EVENING_UTC)).toBe("19:04:09");
    });
  });
});

describe("localDay", () => {
  describe("given two instants on one UTC day that straddle the reader's midnight", () => {
    it("reports them as different days, so a listing can say so", () => {
      expect(localDay(EARLY_EVENING_UTC)).toBe("2024-07-03");
      expect(localDay(LATE_EVENING_UTC)).toBe("2024-07-04");
    });
  });
});

describe("dayHeading", () => {
  describe("given an instant past the reader's midnight", () => {
    it("names the reader's date, not the UTC one", () => {
      expect(dayHeading(LATE_EVENING_UTC)).toContain("4");
      expect(dayHeading(LATE_EVENING_UTC)).toMatch(/Jul/i);
    });
  });
});
