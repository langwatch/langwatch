import { describe, expect, it } from "vitest";

import { nextResetAt, shouldResetBudget } from "../budgetWindow";

describe("budget window math", () => {
  describe("nextResetAt", () => {
    describe("when window is MINUTE", () => {
      it("rolls to the next whole minute", () => {
        const now = new Date(Date.UTC(2026, 3, 18, 15, 30, 42, 500));
        expect(nextResetAt("MINUTE", now).toISOString()).toBe(
          "2026-04-18T15:31:00.000Z",
        );
      });
    });

    describe("when window is HOUR", () => {
      it("rolls to the next whole hour", () => {
        const now = new Date(Date.UTC(2026, 3, 18, 15, 30, 42));
        expect(nextResetAt("HOUR", now).toISOString()).toBe(
          "2026-04-18T16:00:00.000Z",
        );
      });
    });

    describe("when window is DAY", () => {
      it("rolls to 00:00 UTC the next calendar day", () => {
        const now = new Date(Date.UTC(2026, 3, 18, 23, 59, 59));
        expect(nextResetAt("DAY", now).toISOString()).toBe(
          "2026-04-19T00:00:00.000Z",
        );
      });
    });

    describe("when window is WEEK", () => {
      it("rolls to next Monday 00:00 UTC from Sunday", () => {
        // 2026-04-19 is a Sunday
        const now = new Date(Date.UTC(2026, 3, 19, 12, 0, 0));
        expect(nextResetAt("WEEK", now).toISOString()).toBe(
          "2026-04-20T00:00:00.000Z",
        );
      });

      it("rolls to next Monday when anchor is Monday itself", () => {
        // 2026-04-20 is a Monday
        const now = new Date(Date.UTC(2026, 3, 20, 12, 0, 0));
        expect(nextResetAt("WEEK", now).toISOString()).toBe(
          "2026-04-27T00:00:00.000Z",
        );
      });
    });

    describe("when window is MONTH", () => {
      it("rolls to the first of next calendar month at 00:00 UTC", () => {
        const now = new Date(Date.UTC(2026, 3, 18, 10, 0, 0));
        expect(nextResetAt("MONTH", now).toISOString()).toBe(
          "2026-05-01T00:00:00.000Z",
        );
      });

      it("handles December → January correctly", () => {
        const now = new Date(Date.UTC(2026, 11, 31, 23, 59));
        expect(nextResetAt("MONTH", now).toISOString()).toBe(
          "2027-01-01T00:00:00.000Z",
        );
      });
    });

    describe("when window is TOTAL", () => {
      it("returns a far-future sentinel (year 9999)", () => {
        const result = nextResetAt("TOTAL");
        expect(result.getUTCFullYear()).toBe(9999);
      });
    });
  });

  describe("shouldResetBudget", () => {
    describe("when window is TOTAL", () => {
      it("never resets", () => {
        expect(
          shouldResetBudget(
            "TOTAL",
            new Date(Date.UTC(2020, 0, 1)),
            new Date(Date.UTC(9000, 0, 1)),
          ),
        ).toBe(false);
      });
    });

    describe("when now is before the reset instant", () => {
      it("returns false", () => {
        expect(
          shouldResetBudget(
            "DAY",
            new Date(Date.UTC(2026, 3, 19, 0, 0, 0)),
            new Date(Date.UTC(2026, 3, 18, 23, 59, 59)),
          ),
        ).toBe(false);
      });
    });

    describe("when now is at or past the reset instant", () => {
      it("returns true at the boundary", () => {
        const reset = new Date(Date.UTC(2026, 3, 19, 0, 0, 0));
        expect(shouldResetBudget("DAY", reset, reset)).toBe(true);
      });

      it("accepts an ISO string for resetsAt", () => {
        expect(
          shouldResetBudget(
            "HOUR",
            "2026-04-18T15:00:00.000Z",
            new Date(Date.UTC(2026, 3, 18, 15, 0, 1)),
          ),
        ).toBe(true);
      });
    });
  });
});
