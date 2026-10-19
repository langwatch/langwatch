import { describe, expect, it } from "vitest";

import { isUsageReportDue, nextNoonUtc } from "../usage-report-schedule.rules.ts";

const at = (iso: string) => Date.parse(iso);

describe("nextNoonUtc", () => {
  it("is today's noon while it is still ahead, and tomorrow's after", () => {
    expect(new Date(nextNoonUtc(at("2026-09-21T10:00:00.000Z"))).toISOString()).toBe(
      "2026-09-21T12:00:00.000Z",
    );
    expect(new Date(nextNoonUtc(at("2026-09-21T12:00:00.000Z"))).toISOString()).toBe(
      "2026-09-22T12:00:00.000Z",
    );
  });
});

describe("isUsageReportDue", () => {
  describe("given the last report went yesterday afternoon", () => {
    const lastReportAt = at("2026-09-20T12:10:00.000Z");

    it("is not due before today's noon", () => {
      expect(isUsageReportDue({ at: at("2026-09-21T11:59:00.000Z"), lastReportAt })).toBe(false);
    });

    it("is due from today's noon on", () => {
      expect(isUsageReportDue({ at: at("2026-09-21T12:00:00.000Z"), lastReportAt })).toBe(true);
      expect(isUsageReportDue({ at: at("2026-09-21T19:00:00.000Z"), lastReportAt })).toBe(true);
    });
  });

  describe("given today's report already went", () => {
    it("is not due again until tomorrow's noon", () => {
      const lastReportAt = at("2026-09-21T12:05:00.000Z");

      expect(isUsageReportDue({ at: at("2026-09-21T23:00:00.000Z"), lastReportAt })).toBe(false);
      expect(isUsageReportDue({ at: at("2026-09-22T12:01:00.000Z"), lastReportAt })).toBe(true);
    });
  });
});
