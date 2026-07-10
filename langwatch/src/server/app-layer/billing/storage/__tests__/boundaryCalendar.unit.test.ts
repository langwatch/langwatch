import { describe, expect, it } from "vitest";

import {
  BILLABLE_AFTER_DAYS,
  computeBoundaryCalendar,
} from "../boundaryCalendar";

const DAY_MS = 24 * 60 * 60 * 1000;

// A week partition is identified by its first day (UTC midnight).
const partitionStart = new Date(Date.UTC(2026, 5, 21)); // 2026-06-21

describe("computeBoundaryCalendar()", () => {
  describe("when retention is below the billable window (free tier)", () => {
    /** @scenario Retention below 35 days produces no billing boundaries */
    it("produces no entry or exit dates", () => {
      expect(
        computeBoundaryCalendar({ partitionStart, retentionDays: 30 }),
      ).toEqual([]);
    });
  });

  describe("when retention is exactly the billable window (35 days)", () => {
    /** @scenario Retention of exactly 35 days nets to zero and is skipped */
    it("skips the partition entirely — entry and exit coincide, net zero", () => {
      expect(
        computeBoundaryCalendar({ partitionStart, retentionDays: 35 }),
      ).toEqual([]);
    });
  });

  describe("when retention is 63 days", () => {
    const crossings = computeBoundaryCalendar({
      partitionStart,
      retentionDays: 63,
    });

    /** @scenario A week partition crosses the billable line over 7 consecutive days */
    it("produces 7 daily entry dates, one per day of the week slice", () => {
      expect(crossings.map((c) => c.entryAt.getTime())).toEqual(
        Array.from(
          { length: 7 },
          (_, day) =>
            partitionStart.getTime() + (day + BILLABLE_AFTER_DAYS) * DAY_MS,
        ),
      );
    });

    /** @scenario Exit dates mirror entry dates shifted by retention minus 35 days */
    it("schedules each exit exactly 28 days after its matching entry", () => {
      expect(
        crossings.map((c) => c.exitAt!.getTime() - c.entryAt.getTime()),
      ).toEqual(Array.from({ length: 7 }, () => (63 - 35) * DAY_MS));
    });

    it("anchors each crossing to its ingest day-slice", () => {
      expect(crossings.map((c) => c.sliceDate.getTime())).toEqual(
        Array.from(
          { length: 7 },
          (_, day) => partitionStart.getTime() + day * DAY_MS,
        ),
      );
    });
  });

  describe("when retention is indefinite (0 = keep forever)", () => {
    it("schedules entries but no exits", () => {
      const crossings = computeBoundaryCalendar({
        partitionStart,
        retentionDays: 0,
      });
      expect(crossings.map((c) => c.exitAt)).toEqual(
        Array.from({ length: 7 }, () => null),
      );
    });
  });
});
