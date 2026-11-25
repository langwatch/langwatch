/**
 * `LW.formatTime` writes a query's UTC time on the reader's clock. Evaluated as a string, as the
 * shim ships.
 * @see modules/analytics/specs/dashboard-widget-time-zone.feature
 */
import { describe, expect, it } from "vitest";

import { buildShimScript } from "../chart-frame-shim-source.ts";

interface ShimLW {
  dashboardContext?: { timezone?: string; granularitySeconds: number };
  formatTime: (value: unknown, options?: Intl.DateTimeFormatOptions) => string;
  parseTime: (value: unknown) => Date;
}

function shimLW(dashboardContext: ShimLW["dashboardContext"]): ShimLW {
  const win: Record<string, unknown> = { parent: {}, addEventListener: () => {} };
  const quiet = { log: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  // The shim ships as a string; evaluating it is the test.
  // oxlint-disable-next-line no-implied-eval
  new Function("window", "console", "setInterval", buildShimScript())(win, quiet, () => 0);
  const lw = win.LW as ShimLW;
  lw.dashboardContext = dashboardContext;

  return lw;
}

describe("given a reader in America/Los_Angeles", () => {
  const hourly = { timezone: "America/Los_Angeles", granularitySeconds: 3600 };

  /** @scenario "TZ11 LW.formatTime writes a time on the reader's clock" */
  it("writes a ClickHouse UTC bucket on the reader's clock", () => {
    expect(shimLW(hourly).formatTime("2026-11-26 00:00:00")).toBe("Nov 25, 4:00 PM");
  });

  /** @scenario "TZ11 LW.formatTime writes a time on the reader's clock" */
  it("writes the day alone at a day grain, and takes Intl options", () => {
    const daily = shimLW({ timezone: "America/Los_Angeles", granularitySeconds: 86_400 });

    expect(daily.formatTime("2026-11-26 07:59:00")).toBe("Nov 25");
    expect(daily.formatTime("2026-11-26 07:59:00", { weekday: "short" })).toBe("Wed");
  });

  /** @scenario "TZ11 LW.formatTime writes a time on the reader's clock" */
  it("reads ISO strings, epoch milliseconds and Dates as the same instant", () => {
    const lw = shimLW(hourly);
    const instant = Date.parse("2026-11-26T00:00:00Z");

    expect(lw.parseTime("2026-11-26 00:00:00").getTime()).toBe(instant);
    expect(lw.formatTime("2026-11-26T00:00:00Z")).toBe("Nov 25, 4:00 PM");
    expect(lw.formatTime(instant)).toBe("Nov 25, 4:00 PM");
    expect(lw.formatTime(new Date(instant))).toBe("Nov 25, 4:00 PM");
  });
});

describe("given a frame with no zone in its context", () => {
  /** @scenario "TZ03 A browser that names no usable time zone falls back to UTC" */
  it("writes UTC, and leaves a value that is no time as it is", () => {
    const lw = shimLW({ granularitySeconds: 3600 });

    expect(lw.formatTime("2026-11-26 00:00:00")).toBe("Nov 26, 12:00 AM");
    expect(lw.formatTime("not a time")).toBe("not a time");
  });
});
