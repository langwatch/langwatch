import { describe, expect, it } from "vitest";

import { computeNextRunAt } from "../cron.ts";
import { Temporal } from "../temporal.ts";

const at = (iso: string) => Temporal.Instant.from(iso);

describe("computeNextRunAt", () => {
  describe("given a weekly cron '0 9 * * 1' (Mondays 09:00)", () => {
    describe("when computing the next run after a mid-week instant", () => {
      it("returns the next Monday at 09:00 in the timezone", () => {
        const next = computeNextRunAt({
          cron: "0 9 * * 1",
          timezone: "UTC",
          after: at("2026-07-08T12:00:00Z"),
        });
        expect(next.toString()).toBe("2026-07-13T09:00:00Z");
      });
    });
  });

  describe("given a daily cron '0 9 * * *' across a US spring-forward DST boundary", () => {
    describe("when the next run lands on the day DST begins", () => {
      it("keeps 09:00 local by tracking the zone — EDT (-04:00), i.e. 13:00Z", () => {
        const next = computeNextRunAt({
          cron: "0 9 * * *",
          timezone: "America/New_York",
          after: at("2026-03-07T15:00:00Z"),
        });
        expect(next.toString()).toBe("2026-03-08T13:00:00Z");
      });
    });

    describe("when the next run lands the day BEFORE DST begins", () => {
      it("uses EST (-05:00), i.e. 14:00Z — proving the offset shifts with the calendar", () => {
        const next = computeNextRunAt({
          cron: "0 9 * * *",
          timezone: "America/New_York",
          after: at("2026-03-06T15:00:00Z"),
        });
        expect(next.toString()).toBe("2026-03-07T14:00:00Z");
      });
    });
  });

  describe("given an instant exactly on a matching slot", () => {
    it("returns the following slot, never the instant itself", () => {
      const next = computeNextRunAt({
        cron: "0 9 * * *",
        timezone: "UTC",
        after: at("2026-07-13T09:00:00Z"),
      });
      expect(next.toString()).toBe("2026-07-14T09:00:00Z");
    });
  });

  describe("given a cron pattern with no reachable future match", () => {
    describe("when computing the next run", () => {
      it("throws rather than returning a bogus instant", () => {
        expect(() =>
          computeNextRunAt({
            cron: "0 9 30 2 *",
            timezone: "UTC",
            after: at("2026-01-01T00:00:00Z"),
          }),
        ).toThrow(Error);
      });
    });
  });
});
