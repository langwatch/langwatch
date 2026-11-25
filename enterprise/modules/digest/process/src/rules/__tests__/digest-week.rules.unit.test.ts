// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The digest's calendar: ISO weeks, which finished week a send covers, and how far back the
 * folds are kept so the sent week's scenario baseline is whole.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { describe, expect, it } from "vitest";

import {
  countCapped,
  isoWeekOf,
  latencyBucketOf,
  latencyPercentile,
  LATENCY_BUCKETS_MS,
  oldestKeptWeek,
  plannableWeek,
  sendableWeek,
  weekLabel,
  weeksBefore,
  weekStartOf,
} from "../digest-week.rules.ts";

const at = (iso: string) => Date.parse(iso);

describe("isoWeekOf()", () => {
  it.each([
    ["2026-11-16T00:00:00Z", "2026-W47"],
    ["2026-11-22T23:59:59Z", "2026-W47"],
    ["2026-01-01T00:00:00Z", "2026-W01"],
    ["2027-01-01T00:00:00Z", "2026-W53"],
    ["2021-01-03T00:00:00Z", "2020-W53"],
  ])("places %s in %s", (instant, isoWeek) => {
    expect(isoWeekOf(at(instant))).toBe(isoWeek);
  });
});

describe("weekStartOf()", () => {
  it.each([
    ["2026-W47", "2026-11-16T00:00:00.000Z"],
    ["2026-W01", "2025-12-29T00:00:00.000Z"],
    ["2020-W53", "2020-12-28T00:00:00.000Z"],
  ])("starts %s on Monday %s", (isoWeek, monday) => {
    expect(new Date(weekStartOf(isoWeek)).toISOString()).toBe(monday);
  });
});

describe("weeksBefore()", () => {
  it("counts back across a year boundary, newest first", () => {
    expect(weeksBefore({ isoWeek: "2026-W02", count: 3 })).toEqual([
      "2026-W01",
      "2025-W52",
      "2025-W51",
    ]);
  });
});

describe("sendableWeek()", () => {
  describe("when Monday 08:00 UTC has not passed", () => {
    it("still covers the week before last", () => {
      expect(sendableWeek(at("2026-11-16T07:59:59Z"))).toBe("2026-W45");
    });
  });

  describe("when Monday 08:00 UTC has passed", () => {
    it("covers last week from then until next Monday's send", () => {
      expect(sendableWeek(at("2026-11-16T08:00:00Z"))).toBe("2026-W46");
      expect(sendableWeek(at("2026-11-19T12:00:00Z"))).toBe("2026-W46");
    });
  });

  describe("when the week that just ended belongs to last year", () => {
    it("covers last year's final week", () => {
      expect(sendableWeek(at("2026-01-05T08:30:00Z"))).toBe("2026-W01");
      expect(sendableWeek(at("2026-01-01T00:00:00Z"))).toBe("2025-W52");
    });
  });
});

describe("plannableWeek()", () => {
  describe("when Monday 08:00 UTC has not passed", () => {
    it("is none, so a plan never reaches back to the week before last", () => {
      expect(plannableWeek(at("2026-11-16T00:00:00Z"))).toEqual({ kind: "closed" });
      expect(plannableWeek(at("2026-11-16T07:59:59Z"))).toEqual({ kind: "closed" });
    });
  });

  describe("when Monday 08:00 UTC has passed", () => {
    it("is last week from then until the week ends", () => {
      expect(plannableWeek(at("2026-11-16T08:00:00Z"))).toEqual({
        kind: "open",
        isoWeek: "2026-W46",
      });
      expect(plannableWeek(at("2026-11-22T23:59:59Z"))).toEqual({
        kind: "open",
        isoWeek: "2026-W46",
      });
    });
  });

  describe("when the week that just ended belongs to last year", () => {
    it("is last year's final week once Monday 08:00 UTC has passed", () => {
      expect(plannableWeek(at("2027-01-04T07:00:00Z"))).toEqual({ kind: "closed" });
      expect(plannableWeek(at("2027-01-04T08:30:00Z"))).toEqual({
        kind: "open",
        isoWeek: "2026-W53",
      });
    });
  });
});

describe("oldestKeptWeek()", () => {
  describe("when last week is the sendable one", () => {
    it("keeps last week and the four its scenario baseline reads", () => {
      expect(oldestKeptWeek(at("2026-11-19T12:00:00Z"))).toBe("2026-W42");
    });
  });
});

describe("weekLabel()", () => {
  it("names a week within one month by its days", () => {
    expect(weekLabel("2026-W47")).toBe("Nov 16 to 22");
  });

  it("names a week across two months by both", () => {
    expect(weekLabel("2026-W01")).toBe("Dec 29 to Jan 4");
  });
});

describe("latencyPercentile()", () => {
  describe("when nothing was timed", () => {
    it("is zero", () => {
      expect(latencyPercentile({ latency: [0, 0, 0], percentile: 95 })).toBe(0);
    });
  });

  describe("when most traces are fast and a few are slow", () => {
    it("reads each percentile as the upper bound of the bucket it lands in", () => {
      const latency = LATENCY_BUCKETS_MS.map(() => 0).concat(0);
      latency[0] = 90;
      latency[5] = 10;

      expect(latencyPercentile({ latency, percentile: 50 })).toBe(100);
      expect(latencyPercentile({ latency, percentile: 95 })).toBe(5_000);
    });
  });
});

describe("countCapped()", () => {
  describe("when the map already holds `cap` keys", () => {
    const full = { a: 1, b: 2 };

    it("drops a new key", () => {
      expect(countCapped({ counts: full, key: "c", cap: 2 })).toEqual({ a: 1, b: 2 });
    });

    it("still adds to a key it holds", () => {
      expect(countCapped({ counts: full, key: "b", by: 3, cap: 2 })).toEqual({ a: 1, b: 5 });
    });
  });

  describe("when the map has room", () => {
    it("adds a new key", () => {
      expect(countCapped({ counts: { a: 1 }, key: "b", cap: 2 })).toEqual({ a: 1, b: 1 });
    });
  });
});

describe("latencyBucketOf()", () => {
  it.each([
    [0, 0],
    [100, 0],
    [101, 1],
    [250, 1],
    [60_000, LATENCY_BUCKETS_MS.length - 1],
  ])("places %d ms in bucket %d, a bound inside its own bucket", (durationMs, bucket) => {
    expect(latencyBucketOf(durationMs)).toBe(bucket);
  });

  describe("when a duration passes the last bound", () => {
    it("lands in the overflow bucket", () => {
      expect(latencyBucketOf(60_001)).toBe(LATENCY_BUCKETS_MS.length);
    });
  });
});
