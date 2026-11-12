/**
 * The window flags with a fixed clock and a fixed time zone: what each value an
 * agent would type resolves to, and which ones are refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  commandLine,
  parseWindowValue,
  resolveTimeWindow,
  TimeWindowError,
  widerLookback,
  windowDocument,
} from "../timeWindow";

// 2026-11-12 15:30 in Sao Paulo (UTC-3 all year, no daylight saving).
const NOW = Date.parse("2026-11-12T18:30:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "America/Sao_Paulo";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

const start = (value: string) => parseWindowValue({ value, bound: "start", now: NOW });
const end = (value: string) => parseWindowValue({ value, bound: "end", now: NOW });
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe("parseWindowValue()", () => {
  describe("when given a lookback", () => {
    /** @scenario A lookback, a calendar word or a local date is a window bound */
    it("reads minutes, hours, days and weeks as that long before now", () => {
      expect(start("30m")).toBe(NOW - 30 * 60_000);
      expect(start("12h")).toBe(NOW - 12 * HOUR);
      expect(start("7d")).toBe(NOW - 7 * DAY);
      expect(start("2w")).toBe(NOW - 14 * DAY);
      expect(start("3 days ago")).toBe(NOW - 3 * DAY);
    });

    it("reads months as calendar months, not 30-day blocks", () => {
      expect(iso(start("3mo"))).toBe("2026-08-12T18:30:00.000Z");
      expect(iso(start("1y"))).toBe("2025-11-12T18:30:00.000Z");
    });
  });

  describe("when given a calendar word", () => {
    it("reads now as the clock", () => {
      expect(start("now")).toBe(NOW);
    });

    it("reads today and yesterday as local midnight", () => {
      expect(iso(start("today"))).toBe("2026-11-12T03:00:00.000Z");
      expect(iso(start("yesterday"))).toBe("2026-11-11T03:00:00.000Z");
    });

    it("ends yesterday at the end of that day and today at now", () => {
      expect(iso(end("yesterday"))).toBe("2026-11-12T03:00:00.000Z");
      expect(end("today")).toBe(NOW);
    });
  });

  describe("when given a date with no time", () => {
    it("starts at local midnight, not UTC midnight", () => {
      expect(iso(start("2026-11-10"))).toBe("2026-11-10T03:00:00.000Z");
    });

    it("ends at the end of that local day", () => {
      expect(iso(end("2026-11-10"))).toBe("2026-11-11T03:00:00.000Z");
    });

    it("refuses a day that does not exist", () => {
      expect(start("2026-02-30")).toBeNull();
    });
  });

  describe("when given an instant", () => {
    it("reads ISO-8601 and epoch milliseconds as they are", () => {
      expect(start("2026-11-10T09:00:00Z")).toBe(Date.parse("2026-11-10T09:00:00Z"));
      expect(start("1789000000000")).toBe(1789000000000);
    });

    it("refuses words it does not know", () => {
      expect(start("last tuesday")).toBeNull();
      expect(start("0d")).toBeNull();
    });
  });
});

describe("resolveTimeWindow()", () => {
  describe("when no bound is given", () => {
    it("reads the last 7 days and says it is the default", () => {
      const window = resolveTimeWindow({ now: NOW });
      expect(window).toEqual({ from: NOW - 7 * DAY, to: NOW, isExplicit: false });
      expect(windowDocument({ window, lookback: "7d" })).toEqual({
        from: "2026-11-05T18:30:00.000Z",
        to: "2026-11-12T18:30:00.000Z",
        lookback: "7d",
        widened: false,
      });
    });
  });

  describe("when --since is given", () => {
    it("starts there and ends now", () => {
      expect(resolveTimeWindow({ since: "30d", now: NOW })).toEqual({
        from: NOW - 30 * DAY,
        to: NOW,
        isExplicit: true,
      });
    });

    it("refuses --since together with --start-date", () => {
      expect(() => resolveTimeWindow({ since: "30d", startDate: "7d", now: NOW })).toThrow(
        TimeWindowError,
      );
    });
  });

  describe("when the same day is both bounds", () => {
    it("covers that whole local day", () => {
      const window = resolveTimeWindow({
        startDate: "2026-11-10",
        endDate: "2026-11-10",
        now: NOW,
      });
      expect(window.to - window.from).toBe(DAY);
    });
  });

  describe("when a bound is not a value it knows", () => {
    it("names the flag and lists what it accepts", () => {
      expect(() => resolveTimeWindow({ endDate: "soon", now: NOW })).toThrow(
        /Invalid --end-date "soon"\. Accepted: .*7d/,
      );
    });
  });

  describe("when the start is not before the end", () => {
    it("refuses the empty window", () => {
      expect(() =>
        resolveTimeWindow({ startDate: "today", endDate: "yesterday", now: NOW }),
      ).toThrow(/not before --end-date/);
    });
  });
});

describe("widerLookback()", () => {
  it("offers the next lookback that covers more than the window", () => {
    expect(widerLookback({ window: resolveTimeWindow({ now: NOW }) })).toBe("30d");
    expect(widerLookback({ window: resolveTimeWindow({ since: "30d", now: NOW }) })).toBe("90d");
    expect(widerLookback({ window: resolveTimeWindow({ since: "2y", now: NOW }) })).toBeUndefined();
  });
});

describe("commandLine()", () => {
  it("quotes values a shell would split and leaves plain ones bare", () => {
    expect(
      commandLine({
        base: "langwatch trace search",
        flags: [
          ["-q", "refund it's late"],
          ["--origin", "application,simulation"],
          ["--errors-only", true],
          ["--project", undefined],
          ["--since", "30d"],
        ],
      }),
    ).toBe(
      "langwatch trace search -q 'refund it'\\''s late' --origin application,simulation --errors-only --since 30d",
    );
  });
});
