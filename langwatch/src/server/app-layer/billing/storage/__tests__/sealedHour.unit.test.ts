import { describe, expect, it } from "vitest";

import {
  currentSealedHour,
  floorToDay,
  floorToHour,
  partitionKeyFor,
  partitionStartFor,
} from "../sealedHour";

describe("currentSealedHour()", () => {
  describe("when the current hour is still filling", () => {
    it("returns the previous full hour", () => {
      expect(
        currentSealedHour(new Date(Date.UTC(2026, 6, 10, 14, 25, 3))),
      ).toEqual(new Date(Date.UTC(2026, 6, 10, 13)));
    });
  });
});

describe("floorToHour() / floorToDay()", () => {
  it("floors to the UTC hour", () => {
    expect(floorToHour(new Date(Date.UTC(2026, 6, 10, 14, 59, 59)))).toEqual(
      new Date(Date.UTC(2026, 6, 10, 14)),
    );
  });

  it("floors to UTC midnight", () => {
    expect(floorToDay(new Date(Date.UTC(2026, 6, 10, 23, 1)))).toEqual(
      new Date(Date.UTC(2026, 6, 10)),
    );
  });
});

describe("partitionStartFor()", () => {
  // Reference values verified against a real ClickHouse `toYearWeek`
  // (default mode): weeks start Sunday; 2025-12-31 + 2026-01-01 share
  // partition 202552 (block 2025-12-28..2026-01-03); 2026-01-04 and
  // 2026-07-05 are Sundays starting fresh partitions.
  describe("when the day is a Sunday", () => {
    it("returns the day itself", () => {
      expect(partitionStartFor(new Date(Date.UTC(2026, 6, 5)))).toEqual(
        new Date(Date.UTC(2026, 6, 5)),
      );
    });
  });

  describe("when the day is mid-week", () => {
    it("returns the previous Sunday", () => {
      expect(partitionStartFor(new Date(Date.UTC(2026, 6, 4)))).toEqual(
        new Date(Date.UTC(2026, 5, 28)),
      );
    });
  });

  describe("when the week spans a year boundary", () => {
    it("keeps New Year's Eve and New Year's Day in the same partition", () => {
      const eve = partitionStartFor(new Date(Date.UTC(2025, 11, 31)));
      const day = partitionStartFor(new Date(Date.UTC(2026, 0, 1)));
      expect(eve).toEqual(day);
    });

    it("anchors that partition at the preceding Sunday", () => {
      expect(partitionStartFor(new Date(Date.UTC(2026, 0, 1)))).toEqual(
        new Date(Date.UTC(2025, 11, 28)),
      );
    });
  });
});

describe("partitionKeyFor()", () => {
  it("labels the partition by its Sunday-start ISO date", () => {
    expect(partitionKeyFor(new Date(Date.UTC(2026, 6, 8)))).toEqual(
      "2026-07-05",
    );
  });
});
