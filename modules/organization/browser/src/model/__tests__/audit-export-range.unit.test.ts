import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { auditExportWindows } from "../audit-export-range.ts";

const now = Temporal.Instant.from("2026-10-10T12:00:00Z");
const view = {
  startDate: Temporal.Instant.from("2026-10-01T00:00:00Z"),
  endDate: Temporal.Instant.from("2026-10-02T00:00:00Z"),
};
const custom = { from: "", to: "" };

describe("auditExportWindows()", () => {
  /** @scenario An export asks how much history to take, keeping every other filter */
  it("takes the view's own window for the current view", () => {
    expect(auditExportWindows({ range: "view", view, now, custom })).toEqual([
      { startDate: view.startDate.epochMilliseconds, endDate: view.endDate.epochMilliseconds },
    ]);
  });

  /** @scenario An export asks how much history to take, keeping every other filter */
  it("reads all time from the epoch to now", () => {
    expect(auditExportWindows({ range: "all", view, now, custom })).toEqual([
      { startDate: 0, endDate: now.epochMilliseconds },
    ]);
  });

  /** @scenario An export asks how much history to take, keeping every other filter */
  it("ends a preset window now", () => {
    const [span] = auditExportWindows({ range: "7d", view, now, custom });
    expect(span?.endDate).toBe(now.epochMilliseconds);
    expect(span?.startDate).toBeLessThan(now.epochMilliseconds);
  });

  describe("given a custom range", () => {
    /** @scenario An export asks how much history to take, keeping every other filter */
    it("covers both days whole", () => {
      const [span] = auditExportWindows({
        range: "custom",
        view,
        now,
        custom: { from: "2026-10-01", to: "2026-10-01" },
      });
      expect(span).toBeDefined();
      expect((span?.endDate ?? 0) - (span?.startDate ?? 0)).toBeGreaterThanOrEqual(
        23 * 60 * 60 * 1000,
      );
    });

    /** @scenario An export asks how much history to take, keeping every other filter */
    it("offers nothing to export while unfinished or backwards", () => {
      const half = { from: "2026-10-01", to: "" };
      const backwards = { from: "2026-10-05", to: "2026-10-01" };
      expect(auditExportWindows({ range: "custom", view, now, custom: half })).toEqual([]);
      expect(auditExportWindows({ range: "custom", view, now, custom: backwards })).toEqual([]);
    });
  });
});
