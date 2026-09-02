/**
 * The window the audit trail is read over.
 *
 * A narrowed copy of the platform period selector, with the router taken out —
 * which is what lets the reading and the writes be asserted at all. `now` is a
 * parameter everywhere, because a relative window anchored to a hidden clock is
 * a function whose answer nobody can state.
 *
 * Spec: specs/audit-log/audit-log.feature
 */

import { describe, expect, it } from "vitest";
import {
  auditPeriodLabel,
  auditPeriodQuery,
  computeAuditWindow,
  isAuditPeriodPresetKey,
  readAuditPeriod,
} from "../audit-period";

const NOW = new Date("2026-03-04T15:20:00.000Z");

describe("given an address with no window in it", () => {
  describe("when the window is read", () => {
    /** @scenario The audit table opens on the last thirty days */
    it("falls back to the last thirty days, relative", () => {
      const { period, mode } = readAuditPeriod({}, NOW);

      expect(mode).toBe("relative");
      expect(period.endDate).toEqual(NOW);
      expect(period.startDate.getTime()).toBeLessThan(NOW.getTime());
    });
  });
});

describe("given an address naming a preset", () => {
  describe("when the preset is one the picker offers", () => {
    /** @scenario A picked range is carried in the address */
    it("reads that window", () => {
      const { period, mode } = readAuditPeriod({ period: "24h" }, NOW);

      expect(mode).toBe("relative");
      expect(period.endDate).toEqual(NOW);
      expect(NOW.getTime() - period.startDate.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe("when the preset is one it does not", () => {
    /** @scenario The audit table opens on the last thirty days */
    it("falls back rather than asking for a window nobody defined", () => {
      expect(isAuditPeriodPresetKey("3y")).toBe(false);
      const fallback = readAuditPeriod({ period: "3y" }, NOW);
      const thirty = readAuditPeriod({}, NOW);

      expect(fallback.period.startDate).toEqual(thirty.period.startDate);
    });
  });
});

describe("given an address naming an absolute range", () => {
  describe("when both ends are readable", () => {
    /** @scenario A picked range is carried in the address */
    it("prefers it over any preset also present", () => {
      const { period, mode } = readAuditPeriod(
        {
          period: "24h",
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: "2026-01-31T00:00:00.000Z",
        },
        NOW,
      );

      expect(mode).toBe("absolute");
      expect(period.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(period.endDate.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    });
  });

  describe("when the range runs backwards", () => {
    /**
     * A hand-edited URL should narrow to nothing visible, not ask the server
     * for a range that runs backwards.
     */
    /** @scenario A picked range is carried in the address */
    it("clamps the start to the end rather than refusing", () => {
      const { period } = readAuditPeriod(
        { startDate: "2026-02-01T00:00:00.000Z", endDate: "2026-01-01T00:00:00.000Z" },
        NOW,
      );

      expect(period.startDate).toEqual(period.endDate);
    });
  });

  describe("when one end is unreadable", () => {
    /** @scenario The audit table opens on the last thirty days */
    it("ignores the pair and reads a relative window", () => {
      expect(readAuditPeriod({ startDate: "yesterday", endDate: "today" }, NOW).mode).toBe(
        "relative",
      );
    });
  });
});

describe("given a reader picking a window", () => {
  describe("when the next address is written", () => {
    /**
     * An absolute pair left beside the preset would win the reading, and the
     * picker would look like it did nothing.
     */
    /** @scenario A picked range is carried in the address */
    it("drops any absolute pair and returns to the first page", () => {
      expect(
        auditPeriodQuery(
          { startDate: "2026-01-01", endDate: "2026-01-31", pageOffset: "50", actionFilter: "x" },
          "7d",
        ),
      ).toEqual({ period: "7d", pageOffset: "0", actionFilter: "x" });
    });
  });
});

describe("given a window on screen", () => {
  describe("when it matches a preset", () => {
    /** @scenario The range control names the window it is applying */
    it("names the preset rather than two dates", () => {
      expect(auditPeriodLabel(computeAuditWindow("7d", NOW), "relative", NOW)).toBe("Last 7 days");
      expect(auditPeriodLabel(computeAuditWindow("1h", NOW), "relative", NOW)).toBe("Last 1 hour");
    });
  });

  describe("when it was typed rather than picked", () => {
    /** @scenario The range control names the window it is applying */
    it("names both ends", () => {
      const label = auditPeriodLabel(
        {
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: new Date("2026-01-31T00:00:00.000Z"),
        },
        "absolute",
        NOW,
      );

      expect(label).toContain("-");
    });
  });
});
