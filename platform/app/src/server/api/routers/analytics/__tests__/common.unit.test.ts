import { describe, expect, it } from "vitest";
import { currentVsPreviousDates } from "../common";

const DAY_MS = 86_400_000;
const endDate = Date.UTC(2026, 9, 8);
const startDate = endDate - 30 * DAY_MS;

describe("currentVsPreviousDates", () => {
  describe("when the panel shows the previous period", () => {
    it("starts the previous window one inclusive range length before the current start", () => {
      const { previousPeriodStartDate, startDate: start } =
        currentVsPreviousDates({
          projectId: "p",
          startDate,
          endDate,
          filters: {},
        });

      expect(start.getTime()).toBe(startDate);
      expect(previousPeriodStartDate.getTime()).toBe(startDate - 31 * DAY_MS);
    });
  });

  describe("when the panel skips the previous period", () => {
    /** @scenario A panel that hides the previous period does not scan it */
    it("collapses the previous window to an empty range at the current start", () => {
      const { previousPeriodStartDate, startDate: start } =
        currentVsPreviousDates({
          projectId: "p",
          startDate,
          endDate,
          filters: {},
          shouldSkipPreviousPeriod: true,
        });

      expect(previousPeriodStartDate.getTime()).toBe(start.getTime());
    });
  });
});
