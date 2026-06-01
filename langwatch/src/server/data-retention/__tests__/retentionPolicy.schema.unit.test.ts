import { describe, expect, it } from "vitest";
import {
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RETENTION_WEEK_DAYS,
  retentionDaysSchema,
} from "../retentionPolicy.schema";

describe("retentionDaysSchema", () => {
  describe("given a whole-week value within the allowed range", () => {
    it("accepts the minimum (7 weeks)", () => {
      expect(retentionDaysSchema.safeParse(MIN_RETENTION_DAYS).success).toBe(
        true,
      );
    });

    it("accepts the UInt16-aligned ceiling", () => {
      expect(retentionDaysSchema.safeParse(MAX_RETENTION_DAYS).success).toBe(
        true,
      );
    });

    it("accepts an arbitrary whole-week value", () => {
      expect(retentionDaysSchema.safeParse(308).success).toBe(true);
    });
  });

  describe("when the value is not a whole number of weeks", () => {
    // Every managed table is partitioned weekly (toYearWeek), so retention
    // must align to a 7-day boundary.
    it("rejects a day count that isn't a multiple of 7", () => {
      expect(
        retentionDaysSchema.safeParse(MIN_RETENTION_DAYS + 1).success,
      ).toBe(false);
      expect(retentionDaysSchema.safeParse(50).success).toBe(false);
    });
  });

  describe("when the value would overflow the ClickHouse UInt16 column", () => {
    // Regression: without an upper bound an admin could save e.g. 100002 days
    // to Postgres, then ingestion/retroactive writes silently wrap it on the
    // UInt16 `_retention_days` column (migration 00032). 100002 is a multiple
    // of 7, so only the max bound rejects it.
    it("rejects a whole-week count above the ceiling", () => {
      expect(retentionDaysSchema.safeParse(100002).success).toBe(false);
      expect(
        retentionDaysSchema.safeParse(MAX_RETENTION_DAYS + RETENTION_WEEK_DAYS)
          .success,
      ).toBe(false);
    });
  });

  describe("when the value is below the minimum", () => {
    it("rejects it even when it is a whole number of weeks", () => {
      expect(
        retentionDaysSchema.safeParse(MIN_RETENTION_DAYS - RETENTION_WEEK_DAYS)
          .success,
      ).toBe(false);
    });
  });

  describe("when the value is not an integer", () => {
    it("rejects it", () => {
      expect(retentionDaysSchema.safeParse(49.5).success).toBe(false);
    });
  });
});
