/**
 * Missing data is a gap, never a 0: the charts library keeps null through its number reading,
 * merges the empty buckets the completeness report lists, and draws no bar or cell for a value
 * it does not have.
 * @see modules/analytics/specs/dashboard-widget-gaps.feature
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Heatmap, Leaderboard, mergeBuckets, toNumber } from "../index";

interface Element {
  type: unknown;
  props: Record<string, unknown> | null;
  children: unknown[];
}

/** A stand-in for the frame's React: elements as plain trees the test can walk. */
const fakeReact = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) =>
    ({ type, props, children }) satisfies Element,
};

function descendants(node: unknown): Element[] {
  if (!node || typeof node !== "object" || !("children" in node)) return [];
  const element = node as Element;
  return [element, ...element.children.flatMap(descendants)];
}

const scope = globalThis as { window?: unknown };

beforeEach(() => {
  scope.window = { React: fakeReact, Recharts: {}, LW: { theme: "light" } };
});
afterEach(() => {
  delete scope.window;
});

describe("toNumber", () => {
  /** @scenario "The charts library keeps a missing value as null" */
  it("keeps null, undefined, NaN and an empty string as null", () => {
    for (const missing of [null, undefined, Number.NaN, "", "not a number"]) {
      expect(toNumber(missing)).toBeNull();
    }
  });

  it("reads numbers and numeric strings, a real 0 included", () => {
    expect(toNumber(0)).toBe(0);
    expect(toNumber("12.5")).toBe(12.5);
  });
});

describe("mergeBuckets", () => {
  const buckets = [
    { start: "2026-10-06T00:00:00Z", n: 0 },
    { start: "2026-10-07T00:00:00Z", n: 8 },
    { start: "2026-10-08T00:00:00Z", n: 0 },
  ];

  /** @scenario "Empty buckets from the report are merged into the rows" */
  it("adds the leading and trailing buckets, a measure as null and a count as 0", () => {
    const rows = [{ bucket: "2026-10-07 00:00:00.000", p95: 840, traces: 8 }];

    const merged = mergeBuckets({
      rows,
      buckets,
      x: "bucket",
      series: ["p95", { key: "traces", kind: "count" }],
    });

    expect(merged).toEqual([
      { bucket: "2026-10-06 00:00:00", p95: null, traces: 0 },
      { bucket: "2026-10-07 00:00:00.000", p95: 840, traces: 8 },
      { bucket: "2026-10-08 00:00:00", p95: null, traces: 0 },
    ]);
  });

  it("matches a row to its bucket by instant, however either spells it", () => {
    const merged = mergeBuckets({
      rows: [{ bucket: "2026-10-06T00:00:00Z", p95: 1 }],
      buckets,
      x: "bucket",
    });

    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual({ bucket: "2026-10-06T00:00:00Z", p95: 1 });
  });

  it("returns the rows as they are when there is no report", () => {
    const rows = [{ bucket: "2026-10-07 00:00:00", p95: 1 }];

    expect(mergeBuckets({ rows, buckets: null, x: "bucket" })).toEqual(rows);
  });
});

describe("Leaderboard", () => {
  /** @scenario "A leaderboard row with no value draws no bar and sorts last" */
  it("ranks a row with no value last, with no bar and a dash for its figure", () => {
    const tree = Leaderboard({
      data: [
        { model: "unpriced", cost: null },
        { model: "cheap", cost: 1 },
        { model: "dear", cost: 9 },
      ],
      labelKey: "model",
      valueKey: "cost",
      format: "currency",
    });

    const texts = descendants(tree).flatMap((element) =>
      element.children.filter((child) => typeof child === "string"),
    );
    expect(texts).toEqual(["dear", "$9", "cheap", "$1", "unpriced", "–"]);
    const widths = descendants(tree)
      .map((element) => (element.props?.style as { width?: string } | undefined)?.width)
      .filter((width) => width?.endsWith("%"));
    expect(widths.at(-1)).toBe("0%");
  });
});

describe("Heatmap", () => {
  const data = [{ hour: "1", weekday: "Mon", value: 4 }];
  const cells = (kind?: "count" | "measure") =>
    descendants(
      Heatmap({
        data,
        xKey: "hour",
        yKey: "weekday",
        valueKey: "value",
        xLabels: ["1", "2"],
        yLabels: ["Mon"],
        ...(kind ? { kind } : {}),
      }),
    ).filter((element) => typeof element.props?.title === "string");

  /** @scenario "A heatmap cell with no data is a gap unless the series counts" */
  it("draws a cell with no row as an empty gap by default", () => {
    expect(cells().map((cell) => cell.props?.title)).toEqual(["Mon / 1: 4", "Mon / 2: no data"]);
  });

  /** @scenario "A heatmap cell with no data is a gap unless the series counts" */
  it("draws it as 0 when the series counts", () => {
    expect(cells("count").map((cell) => cell.props?.title)).toEqual(["Mon / 1: 4", "Mon / 2: 0"]);
  });
});
