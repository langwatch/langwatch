import { describe, expect, it } from "vitest";

import {
  compareDatasetContents,
  type RetainableVersion,
  versionChunksOfPage,
  versionRowOf,
  versionsToThin,
} from "../dataset-version.rules.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.UTC(2026, 9, 1);
const COLUMNS = [{ name: "input", type: "string" as const }];

/** Monday-based week number, counted independently of the rule under test. */
const mondayWeekOf = (ms: number) => Math.floor((Math.floor(ms / DAY_MS) + 3) / 7);

describe("versionsToThin", () => {
  describe("given automatic versions every hour for the last 60 days", () => {
    const versions: RetainableVersion[] = Array.from({ length: 60 * 24 }, (_, hour) => ({
      id: `v${hour}`,
      createdAtMs: NOW - hour * HOUR_MS,
      protected: false,
    }));
    const thinned = new Set(versionsToThin({ versions, nowMs: NOW }));
    const kept = versions.filter((version) => !thinned.has(version.id));

    /** @scenario "Retention keeps the last day, then one a day for a month, then one a week" */
    it("keeps every version from the last 24 hours", () => {
      const lastDay = versions.filter((version) => NOW - version.createdAtMs < DAY_MS);
      expect(lastDay).toHaveLength(24);
      for (const version of lastDay) expect(thinned.has(version.id)).toBe(false);
    });

    /** @scenario "Retention keeps the last day, then one a day for a month, then one a week" */
    it("keeps the newest version of each day for the 30 days before that", () => {
      const daily = kept.filter((version) => {
        const age = NOW - version.createdAtMs;
        return age >= DAY_MS && age < 31 * DAY_MS;
      });
      const days = daily.map((version) => Math.floor(version.createdAtMs / DAY_MS));
      expect(new Set(days).size).toBe(days.length);
      expect(days).toHaveLength(31);
      for (const version of daily) {
        const sameDayNewer = versions.some(
          (other) =>
            other.createdAtMs > version.createdAtMs &&
            NOW - other.createdAtMs >= DAY_MS &&
            Math.floor(other.createdAtMs / DAY_MS) === Math.floor(version.createdAtMs / DAY_MS),
        );
        expect(sameDayNewer).toBe(false);
      }
    });

    /** @scenario "Retention keeps the last day, then one a day for a month, then one a week" */
    it("keeps one version per week before that", () => {
      const old = versions.filter((version) => NOW - version.createdAtMs >= 31 * DAY_MS);
      const keptOld = kept.filter((version) => NOW - version.createdAtMs >= 31 * DAY_MS);
      const weeks = keptOld.map((version) => mondayWeekOf(version.createdAtMs));
      expect(new Set(weeks).size).toBe(weeks.length);
      expect(weeks.length).toBe(
        new Set(old.map((version) => mondayWeekOf(version.createdAtMs))).size,
      );
    });

    /** @scenario "Retention keeps the last day, then one a day for a month, then one a week" */
    it("always keeps the latest version, however old", () => {
      const lonely = [
        { id: "latest", createdAtMs: NOW - 90 * DAY_MS, protected: false },
        { id: "older", createdAtMs: NOW - 90 * DAY_MS - HOUR_MS, protected: false },
      ];
      expect(versionsToThin({ versions: lonely, nowMs: NOW })).toEqual(["older"]);
    });
  });

  describe("given 40-day-old versions in one week, one of them protected", () => {
    /** @scenario "Retention never thins named or run versions" */
    it("keeps the protected version whatever its age", () => {
      const versions: RetainableVersion[] = [
        { id: "latest", createdAtMs: NOW, protected: false },
        { id: "newest-of-week", createdAtMs: NOW - 40 * DAY_MS, protected: false },
        { id: "named", createdAtMs: NOW - 40 * DAY_MS - HOUR_MS, protected: true },
        { id: "plain", createdAtMs: NOW - 40 * DAY_MS - 2 * HOUR_MS, protected: false },
      ];
      expect(versionsToThin({ versions, nowMs: NOW })).toEqual(["plain"]);
    });
  });
});

describe("compareDatasetContents", () => {
  const before = {
    columns: COLUMNS,
    rows: [
      { id: "a", entry: { input: "one" } },
      { id: "b", entry: { input: "two" } },
      { id: "c", entry: { input: "three" } },
    ],
  };

  /** @scenario "Comparing a version with the current content" */
  it("sorts rows into added, removed, changed and unchanged by row id", () => {
    const after = {
      columns: COLUMNS,
      rows: [
        { id: "a", entry: { input: "one" } },
        { id: "b", entry: { input: "TWO" } },
        { id: "d", entry: { input: "four" } },
      ],
    };

    const comparison = compareDatasetContents({ version: 1, against: null, before, after });

    expect(comparison.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(comparison.changed).toEqual([
      { id: "b", before: { input: "two" }, after: { input: "TWO" } },
    ]);
    expect(comparison.truncated).toBe(false);
  });

  /** @scenario "Comparing a version with the current content" */
  it("treats key order inside an entry as no change", () => {
    const left = { columns: COLUMNS, rows: [{ id: "a", entry: { x: 1, y: 2 } }] };
    const right = { columns: COLUMNS, rows: [{ id: "a", entry: { y: 2, x: 1 } }] };

    expect(
      compareDatasetContents({ version: 1, against: 2, before: left, after: right }).counts,
    ).toMatchObject({ changed: 0, unchanged: 1 });
  });

  /** @scenario "Comparing a version with the current content" */
  it("counts every row but lists at most 200, and says so", () => {
    const many = {
      columns: COLUMNS,
      rows: Array.from({ length: 250 }, (_, index) => ({ id: `n${index}`, entry: { input: "x" } })),
    };

    const comparison = compareDatasetContents({
      version: 1,
      against: null,
      before: { columns: COLUMNS, rows: [] },
      after: many,
    });

    expect(comparison.counts.added).toBe(250);
    expect(comparison.added).toHaveLength(200);
    expect(comparison.truncated).toBe(true);
  });

  /** @scenario "Comparing reports column changes" */
  it("lists columns added and removed", () => {
    const after = { columns: [{ name: "expected", type: "string" as const }], rows: before.rows };

    expect(compareDatasetContents({ version: 1, against: null, before, after }).columns).toEqual({
      added: ["expected"],
      removed: ["input"],
    });
  });
});

describe("versionChunksOfPage", () => {
  /** @scenario "Viewing a version shows its own rows and columns" */
  it("names the chunks a page spans", () => {
    expect(versionChunksOfPage({ page: 2, limit: 400, rowCount: 1200 })).toEqual({
      indexes: [0, 1],
      start: 400,
      end: 800,
    });
  });

  /** @scenario "Viewing a version shows its own rows and columns" */
  it("answers no chunks past the last row", () => {
    expect(versionChunksOfPage({ page: 5, limit: 100, rowCount: 120 }).indexes).toEqual([]);
  });
});

describe("versionRowOf", () => {
  /** @scenario "Viewing a version shows its own rows and columns" */
  it("keeps a stored row's id and gives a bare line a positional id", () => {
    expect(versionRowOf({ id: "a", entry: { x: 1 } }, 0)).toEqual({ id: "a", entry: { x: 1 } });
    expect(versionRowOf({ x: 1 }, 7)).toEqual({ id: "row-7", entry: { x: 1 } });
  });
});
