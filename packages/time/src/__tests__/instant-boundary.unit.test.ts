import { describe, expect, it } from "vitest";

import { Temporal } from "../temporal.ts";
import { fromDate, nowInstant, toDate } from "../zoned.ts";

const MOMENT_MS = Date.UTC(2026, 5, 15, 10, 30, 0);

describe("nowInstant", () => {
  describe("given the present moment", () => {
    /** @scenario "The clock reads the present moment as an instant" */
    it("answers with an instant rather than a Date", () => {
      const now = nowInstant();

      expect(now).toBeInstanceOf(Temporal.Instant);
      expect(Math.abs(now.epochMilliseconds - Date.now())).toBeLessThan(5_000);
    });
  });
});

describe("fromDate", () => {
  describe("given a Date handed over by a boundary that only speaks Date", () => {
    /** @scenario "A Date arriving from a boundary becomes an instant naming the same moment" */
    it("names the same epoch millisecond count", () => {
      expect(fromDate(new Date(MOMENT_MS)).epochMilliseconds).toBe(MOMENT_MS);
    });
  });
});

describe("toDate", () => {
  describe("given an instant the product computed with", () => {
    /** @scenario "An instant becomes a Date for a boundary that accepts nothing else" */
    it("names the same epoch millisecond count", () => {
      expect(toDate(Temporal.Instant.fromEpochMilliseconds(MOMENT_MS)).getTime()).toBe(MOMENT_MS);
    });
  });

  describe("given a moment read in the viewer's time zone", () => {
    /** @scenario "A zoned value converts for the same boundary as an instant does" */
    it("names the same epoch millisecond count", () => {
      const zoned =
        Temporal.Instant.fromEpochMilliseconds(MOMENT_MS).toZonedDateTimeISO("Europe/Amsterdam");

      expect(toDate(zoned).getTime()).toBe(MOMENT_MS);
    });
  });
});
