import { describe, expect, it } from "vitest";
import { computeNextRunAt } from "../nextRunAt";

describe("computeNextRunAt", () => {
  describe("given a weekly cron '0 9 * * 1' (Mondays 09:00)", () => {
    describe("when computing the next run after a mid-week instant", () => {
      it("returns the next Monday at 09:00 in the timezone", () => {
        // after: Wed 2026-07-08 12:00Z. Next Monday 09:00 UTC → 2026-07-13.
        const next = computeNextRunAt({
          cron: "0 9 * * 1",
          timezone: "UTC",
          after: new Date("2026-07-08T12:00:00.000Z"),
        });
        expect(next.getUTCDay()).toBe(1); // Monday
        expect(next.getUTCHours()).toBe(9);
        expect(next.getUTCMinutes()).toBe(0);
        expect(next.toISOString()).toBe("2026-07-13T09:00:00.000Z");
      });
    });
  });

  describe("given a daily cron '0 9 * * *' across a US spring-forward DST boundary", () => {
    describe("when the next run lands on the day DST begins", () => {
      it("keeps 09:00 local by tracking the zone — EDT (-04:00), i.e. 13:00Z", () => {
        // 2026 US DST starts Sun 2026-03-08. A 09:00 America/New_York job that
        // day is EDT (-04:00) = 13:00Z, NOT 14:00Z (EST). Evaluating the cron
        // IN the zone (not as a fixed offset) is what makes it DST-correct.
        const next = computeNextRunAt({
          cron: "0 9 * * *",
          timezone: "America/New_York",
          after: new Date("2026-03-07T15:00:00.000Z"), // Sat 10:00 EST
        });
        expect(next.toISOString()).toBe("2026-03-08T13:00:00.000Z");
      });
    });

    describe("when the next run lands the day BEFORE DST begins", () => {
      it("uses EST (-05:00), i.e. 14:00Z — proving the offset shifts with the calendar", () => {
        const next = computeNextRunAt({
          cron: "0 9 * * *",
          timezone: "America/New_York",
          after: new Date("2026-03-06T15:00:00.000Z"), // Fri 10:00 EST
        });
        expect(next.toISOString()).toBe("2026-03-07T14:00:00.000Z");
      });
    });
  });

  describe("given a cron pattern with no reachable future match", () => {
    describe("when computing the next run", () => {
      it("throws rather than persisting a bogus marker", () => {
        // Feb 30 never occurs — croner yields no run.
        expect(() =>
          computeNextRunAt({
            cron: "0 9 30 2 *",
            timezone: "UTC",
            after: new Date("2026-01-01T00:00:00.000Z"),
          }),
        ).toThrow();
      });
    });
  });
});
