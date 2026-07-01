import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
  INDEFINITE_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  PAID_RETENTION_PRESET_DAYS,
  PLATFORM_DEFAULT_RETENTION_DAYS,
  RETENTION_WEEK_DAYS,
  retentionDaysInputSchema,
  retentionDaysSchema,
} from "../retentionPolicy.schema";

describe("retentionDaysSchema", () => {
  describe("given a whole-week value within the allowed range", () => {
    it("accepts the absolute minimum (35 days / 5 weeks, the paid floor)", () => {
      expect(MIN_RETENTION_DAYS).toBe(35);
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

describe("retentionDaysInputSchema", () => {
  // The mutation input accepts the indefinite sentinel (0) IN ADDITION to a
  // finite override; the route authorizes the indefinite case (platform admins
  // only). The plain `retentionDaysSchema` (a tier value) still rejects 0.
  describe("given the indefinite sentinel", () => {
    it("accepts 0 (keep forever)", () => {
      expect(
        retentionDaysInputSchema.safeParse(INDEFINITE_RETENTION_DAYS).success,
      ).toBe(true);
    });

    it("is rejected by the plain tier-value schema", () => {
      expect(
        retentionDaysSchema.safeParse(INDEFINITE_RETENTION_DAYS).success,
      ).toBe(false);
    });
  });

  describe("given a finite value", () => {
    it("accepts a whole-week value at or above the minimum", () => {
      expect(
        retentionDaysInputSchema.safeParse(MIN_RETENTION_DAYS).success,
      ).toBe(true);
      expect(retentionDaysInputSchema.safeParse(91).success).toBe(true);
    });

    it("still rejects a sub-minimum non-zero value", () => {
      expect(retentionDaysInputSchema.safeParse(30).success).toBe(false);
    });

    it("still rejects a value that isn't a whole number of weeks", () => {
      expect(retentionDaysInputSchema.safeParse(50).success).toBe(false);
    });
  });
});

describe("plan-tier retention constants", () => {
  // The paid menu sits below the 49-day recovery floor free/enterprise keep, so
  // the absolute schema floor had to drop to 35 (the gate re-enforces 49 for
  // non-paid custom values). Guard the ordering so the two floors don't drift.
  it("keeps the absolute floor below the enterprise custom floor", () => {
    expect(MIN_RETENTION_DAYS).toBeLessThan(
      ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
    );
    expect(ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS).toBe(49);
  });

  it("has both paid presets whole-week aligned and persistable by the schema", () => {
    expect(PAID_RETENTION_PRESET_DAYS).toEqual([35, 63]);
    for (const days of PAID_RETENTION_PRESET_DAYS) {
      expect(days % RETENTION_WEEK_DAYS).toBe(0);
      expect(retentionDaysSchema.safeParse(days).success).toBe(true);
    }
  });

  it("keeps the shorter paid preset below the enterprise custom floor", () => {
    // This is the whole point of dropping the schema floor: 35 must be a legal
    // stored value even though it is under the 49-day recovery floor.
    expect(PAID_RETENTION_PRESET_DAYS[0]).toBeLessThan(
      ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
    );
  });
});

describe("PLATFORM_DEFAULT_RETENTION_DAYS", () => {
  // Stamped on every new row when a tenant has no override, and written into
  // the UInt16 `_retention_days` column / weekly-partition TTL, so it has to
  // obey the same bounds the schema enforces on a user-set override.
  it("is a whole number of weeks", () => {
    expect(PLATFORM_DEFAULT_RETENTION_DAYS % RETENTION_WEEK_DAYS).toBe(0);
  });

  it("sits within the allowed override range", () => {
    expect(PLATFORM_DEFAULT_RETENTION_DAYS).toBeGreaterThanOrEqual(
      MIN_RETENTION_DAYS,
    );
    expect(PLATFORM_DEFAULT_RETENTION_DAYS).toBeLessThanOrEqual(
      MAX_RETENTION_DAYS,
    );
    expect(
      retentionDaysSchema.safeParse(PLATFORM_DEFAULT_RETENTION_DAYS).success,
    ).toBe(true);
  });
});
