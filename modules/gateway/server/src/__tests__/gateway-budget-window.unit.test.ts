import { Temporal, toDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { GatewayWindow } from "@langwatch/gateway-contract";

describe("budget window math", () => {
  describe("nextResetAt", () => {
    describe("when window is MINUTE", () => {
      it("rolls to the next whole minute", () => {
        const now = Temporal.PlainDateTime.from({
          year: 2026,
          month: 4,
          day: 18,
          hour: 15,
          minute: 30,
          second: 42,
          millisecond: 500,
        })
          .toZonedDateTime("UTC")
          .toInstant();
        expect(toDate(GatewayWindow.nextResetAt("MINUTE", now)).toISOString()).toBe(
          "2026-04-18T15:31:00.000Z",
        );
      });
    });

    describe("when window is HOUR", () => {
      it("rolls to the next whole hour", () => {
        const now = Temporal.PlainDateTime.from({
          year: 2026,
          month: 4,
          day: 18,
          hour: 15,
          minute: 30,
          second: 42,
        })
          .toZonedDateTime("UTC")
          .toInstant();
        expect(toDate(GatewayWindow.nextResetAt("HOUR", now)).toISOString()).toBe(
          "2026-04-18T16:00:00.000Z",
        );
      });
    });

    describe("when window is DAY", () => {
      it("rolls to 00:00 UTC the next calendar day", () => {
        const now = Temporal.PlainDateTime.from({
          year: 2026,
          month: 4,
          day: 18,
          hour: 23,
          minute: 59,
          second: 59,
        })
          .toZonedDateTime("UTC")
          .toInstant();
        expect(toDate(GatewayWindow.nextResetAt("DAY", now)).toISOString()).toBe(
          "2026-04-19T00:00:00.000Z",
        );
      });
    });

    describe("when window is WEEK", () => {
      it("rolls to next Monday 00:00 UTC from Sunday", () => {
        // 2026-04-19 is a Sunday
        const now = Temporal.PlainDateTime.from({
          year: 2026,
          month: 4,
          day: 19,
          hour: 12,
          minute: 0,
          second: 0,
        })
          .toZonedDateTime("UTC")
          .toInstant();
        expect(toDate(GatewayWindow.nextResetAt("WEEK", now)).toISOString()).toBe(
          "2026-04-20T00:00:00.000Z",
        );
      });

      it("rolls to next Monday when anchor is Monday itself", () => {
        // 2026-04-20 is a Monday
        const now = Temporal.PlainDateTime.from({
          year: 2026,
          month: 4,
          day: 20,
          hour: 12,
          minute: 0,
          second: 0,
        })
          .toZonedDateTime("UTC")
          .toInstant();
        expect(toDate(GatewayWindow.nextResetAt("WEEK", now)).toISOString()).toBe(
          "2026-04-27T00:00:00.000Z",
        );
      });
    });

    describe("when window is MONTH", () => {
      it("rolls to the first of next calendar month at 00:00 UTC", () => {
        const now = Temporal.PlainDateTime.from({
          year: 2026,
          month: 4,
          day: 18,
          hour: 10,
          minute: 0,
          second: 0,
        })
          .toZonedDateTime("UTC")
          .toInstant();
        expect(toDate(GatewayWindow.nextResetAt("MONTH", now)).toISOString()).toBe(
          "2026-05-01T00:00:00.000Z",
        );
      });

      it("handles December → January correctly", () => {
        const now = Temporal.PlainDateTime.from({
          year: 2026,
          month: 12,
          day: 31,
          hour: 23,
          minute: 59,
        })
          .toZonedDateTime("UTC")
          .toInstant();
        expect(toDate(GatewayWindow.nextResetAt("MONTH", now)).toISOString()).toBe(
          "2027-01-01T00:00:00.000Z",
        );
      });
    });

    describe("when window is TOTAL", () => {
      it("returns a far-future sentinel (year 9999)", () => {
        const result = GatewayWindow.nextResetAt("TOTAL");
        expect(result.toZonedDateTimeISO("UTC").year).toBe(9999);
      });
    });
  });

  describe("shouldResetBudget", () => {
    describe("when window is TOTAL", () => {
      it("never resets", () => {
        expect(
          GatewayWindow.shouldResetBudget(
            "TOTAL",
            Temporal.PlainDateTime.from({ year: 2020, month: 1, day: 1 })
              .toZonedDateTime("UTC")
              .toInstant(),
            Temporal.PlainDateTime.from({ year: 9000, month: 1, day: 1 })
              .toZonedDateTime("UTC")
              .toInstant(),
          ),
        ).toBe(false);
      });
    });

    describe("when now is before the reset instant", () => {
      it("returns false", () => {
        expect(
          GatewayWindow.shouldResetBudget(
            "DAY",
            Temporal.PlainDateTime.from({
              year: 2026,
              month: 4,
              day: 19,
              hour: 0,
              minute: 0,
              second: 0,
            })
              .toZonedDateTime("UTC")
              .toInstant(),
            Temporal.PlainDateTime.from({
              year: 2026,
              month: 4,
              day: 18,
              hour: 23,
              minute: 59,
              second: 59,
            })
              .toZonedDateTime("UTC")
              .toInstant(),
          ),
        ).toBe(false);
      });
    });

    describe("when now is at or past the reset instant", () => {
      it("returns true at the boundary", () => {
        const reset = Temporal.PlainDateTime.from({
          year: 2026,
          month: 4,
          day: 19,
          hour: 0,
          minute: 0,
          second: 0,
        })
          .toZonedDateTime("UTC")
          .toInstant();
        expect(GatewayWindow.shouldResetBudget("DAY", reset, reset)).toBe(true);
      });

      it("accepts an ISO string for resetsAt", () => {
        expect(
          GatewayWindow.shouldResetBudget(
            "HOUR",
            "2026-04-18T15:00:00.000Z",
            Temporal.PlainDateTime.from({
              year: 2026,
              month: 4,
              day: 18,
              hour: 15,
              minute: 0,
              second: 1,
            })
              .toZonedDateTime("UTC")
              .toInstant(),
          ),
        ).toBe(true);
      });
    });
  });
});
