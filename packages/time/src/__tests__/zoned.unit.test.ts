import { describe, expect, it } from "vitest";

import { Temporal } from "../temporal";
import { toDate, toEpochMs, toZonedDateTime } from "../zoned";
import { compareMoments, differenceInMilliseconds, wallClockSecondsBetween } from "../difference";

const AMSTERDAM = { timeZone: "Europe/Amsterdam" } as const;
const NEW_YORK = { timeZone: "America/New_York" } as const;

/** The instant every wire form below names. */
const MOMENT_MS = Date.UTC(2026, 5, 15, 10, 30, 0);

describe("toEpochMs", () => {
  describe("given the four wire forms of one moment", () => {
    /** @scenario "One moment reads the same whichever wire form carries it" */
    it("reads the same epoch millisecond count from each", () => {
      const zoned = Temporal.Instant.fromEpochMilliseconds(MOMENT_MS).toZonedDateTimeISO("UTC");

      expect(toEpochMs(new Date(MOMENT_MS))).toBe(MOMENT_MS);
      expect(toEpochMs(MOMENT_MS)).toBe(MOMENT_MS);
      expect(toEpochMs("2026-06-15T10:30:00.000Z")).toBe(MOMENT_MS);
      expect(toEpochMs(zoned)).toBe(MOMENT_MS);
    });
  });

  describe("given an ISO string that crossed the wire without a Date wrapper", () => {
    /** @scenario "A date serialised as an ISO string subtracts like a Date" */
    it("subtracts to the same elapsed milliseconds as the Date it was serialised from", () => {
      const earlier = new Date(MOMENT_MS);
      const later = new Date(MOMENT_MS + 90_000);

      expect(differenceInMilliseconds(later.toISOString(), earlier.toISOString())).toBe(90_000);
      expect(differenceInMilliseconds(later, earlier)).toBe(90_000);
      expect(compareMoments(later.toISOString(), earlier)).toBe(1);
      expect(compareMoments(earlier.toISOString(), later.toISOString())).toBe(-1);
      expect(compareMoments(earlier.toISOString(), earlier)).toBe(0);
    });
  });

  describe("given an ISO string with no zone suffix", () => {
    /** @scenario "A zone-less ISO string is read as the runtime reads it" */
    it("reads it the way the platform Date constructor does", () => {
      expect(toEpochMs("2026-06-15T10:30:00")).toBe(new Date("2026-06-15T10:30:00").getTime());
    });
  });

  describe("given a string that names no moment", () => {
    /** @scenario "An unreadable moment fails loudly rather than landing at the epoch" */
    it("reports it as not-a-number rather than as the epoch", () => {
      expect(toEpochMs("not-a-date")).toBeNaN();
    });
  });
});

describe("toZonedDateTime", () => {
  describe("given an input that names no moment", () => {
    /** @scenario "An unreadable moment fails loudly rather than landing at the epoch" */
    it("refuses it rather than silently reading it as 1970", () => {
      expect(() => toZonedDateTime("not-a-date")).toThrow(RangeError);
      expect(() => toZonedDateTime(Number.NaN)).toThrow(RangeError);
      expect(() => toZonedDateTime(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });
  });

  describe("given one instant read in two zones", () => {
    /** @scenario "One moment reads the same whichever wire form carries it" */
    it("keeps the instant and moves only the wall clock", () => {
      const amsterdam = toZonedDateTime(MOMENT_MS, AMSTERDAM);
      const newYork = toZonedDateTime(MOMENT_MS, NEW_YORK);

      expect(amsterdam.epochMilliseconds).toBe(newYork.epochMilliseconds);
      expect(amsterdam.hour).toBe(12);
      expect(newYork.hour).toBe(6);
      expect(toDate(amsterdam).getTime()).toBe(MOMENT_MS);
    });
  });

  describe("given a zoned value carried in from another zone", () => {
    it("re-reads it in the asked-for zone without moving the instant", () => {
      const utc = Temporal.Instant.fromEpochMilliseconds(MOMENT_MS).toZonedDateTimeISO("UTC");

      expect(toZonedDateTime(utc, NEW_YORK).epochMilliseconds).toBe(MOMENT_MS);
      expect(toZonedDateTime(utc, NEW_YORK).hour).toBe(6);
    });
  });
});

describe("wallClockSecondsBetween", () => {
  describe("given a span crossing the spring clock change in Europe/Amsterdam", () => {
    /** @scenario "Relative wording counts the wall clock across a clock change" */
    it("counts the hours the reader saw, not the hour the clock skipped", () => {
      const before = "2026-03-29T01:30:00+01:00";
      const after = "2026-03-29T04:30:00+02:00";

      expect(differenceInMilliseconds(after, before)).toBe(2 * 60 * 60 * 1000);
      expect(wallClockSecondsBetween(after, before, AMSTERDAM)).toBe(3 * 60 * 60);
    });
  });

  describe("given a span crossing the autumn clock change in America/New_York", () => {
    /** @scenario "Relative wording counts the wall clock across a clock change" */
    it("counts the hours the reader saw, not the hour the clock repeated", () => {
      const before = "2026-11-01T00:30:00-04:00";
      const after = "2026-11-01T02:30:00-05:00";

      expect(differenceInMilliseconds(after, before)).toBe(3 * 60 * 60 * 1000);
      expect(wallClockSecondsBetween(after, before, NEW_YORK)).toBe(2 * 60 * 60);
    });
  });

  describe("given the later moment first", () => {
    it("reports the gap as negative rather than as its size", () => {
      expect(wallClockSecondsBetween(MOMENT_MS, MOMENT_MS + 60_000, AMSTERDAM)).toBe(-60);
    });
  });
});
