// @vitest-environment jsdom
/**
 * Every prototype primitive renders both with sample rows and with empty data,
 * without throwing. Rendered with the real React/Recharts instances the
 * sandboxed frame injects as `window.React`/`window.Recharts` (see the module
 * doc in `../index.ts`) via `renderToStaticMarkup`.
 *
 * @see specs/analytics/custom-chart-playground.feature
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Recharts from "recharts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  Badge,
  BarList,
  Bars,
  CalendarHeatmap,
  ComboChart,
  DotStrip,
  Gantt,
  Gauge,
  Histogram,
  KeyLegend,
  LineChart,
  RankedList,
  ScatterDots,
  StatTiles,
  Table,
} from "../index";

declare const window: { React: unknown; Recharts?: unknown; LW?: unknown };

beforeEach(() => {
  window.React = React;
  window.Recharts = Recharts;
});

const render = (element: unknown) =>
  renderToStaticMarkup(element as React.ReactElement);

describe("Badge", () => {
  it("renders its text", () => {
    expect(render(Badge({ text: "measured", tone: "ok" }))).toContain(
      "measured",
    );
    expect(render(Badge({ text: "outline", outline: true }))).toContain(
      "outline",
    );
  });
});

describe("StatTiles", () => {
  it("renders tiles with sample data", () => {
    const html = render(
      StatTiles({
        tiles: [
          {
            value: 1234,
            format: "cost",
            label: "spent",
            badge: { text: "+12%", tone: "warn" },
          },
          { value: 56000, format: "tokens", label: "tokens" },
        ],
        divided: true,
      }),
    );
    expect(html).toContain("spent");
    expect(html).toContain("tokens");
  });
  it("shows an empty state with no tiles", () => {
    expect(render(StatTiles({ tiles: [] }))).toContain("No data");
  });
});

describe("RankedList", () => {
  it("renders rows and honors max", () => {
    const html = render(
      RankedList({
        rows: [
          {
            title: "Session A",
            sub: "repo · 12k tokens",
            value: 42,
            format: "cost",
          },
          { title: "Session B", value: 10, format: "cost" },
        ],
        max: 1,
      }),
    );
    expect(html).toContain("Session A");
    expect(html).not.toContain("Session B");
  });
  it("shows the empty text with no rows", () => {
    expect(
      render(RankedList({ rows: [], emptyText: "Nothing yet" })),
    ).toContain("Nothing yet");
  });
});

describe("BarList", () => {
  it("renders proportional rows", () => {
    const html = render(
      BarList({
        rows: [
          { label: "Read", value: 300, sub: "whole file" },
          { label: "Bash", value: 120 },
        ],
        format: "tokens",
      }),
    );
    expect(html).toContain("Read");
    expect(html).toContain("Bash");
  });
  it("shows an empty state with no rows", () => {
    expect(render(BarList({ rows: [] }))).toContain("No data");
  });
});

describe("Gauge", () => {
  it("renders the arc, needle and value", () => {
    const html = render(
      Gauge({
        value: 0.72,
        label: "cache hit rate",
        badge: { text: "healthy", tone: "ok" },
      }),
    );
    expect(html).toContain("cache hit rate");
    expect(html).toContain("72.0%");
    expect(html).toContain("<svg");
  });
  it("clamps a missing value to zero rather than throwing", () => {
    expect(render(Gauge({ value: NaN, label: "x" }))).toContain("<svg");
  });
});

describe("CalendarHeatmap", () => {
  it("renders cells for sample data", () => {
    const html = render(
      CalendarHeatmap({
        data: [
          { date: "2026-06-01", value: 3 },
          { date: "2026-06-15", value: 1 },
        ],
        endDate: "2026-06-30",
        days: 30,
      }),
    );
    expect(html).toContain("<div");
  });
  it("renders with no data without throwing", () => {
    expect(
      render(CalendarHeatmap({ data: [], endDate: "2026-06-30" })),
    ).toContain("<div");
  });
});

describe("Histogram", () => {
  it("renders buckets and stats", () => {
    const html = render(
      Histogram({
        buckets: [
          { label: "0-1m", value: 46 },
          { label: "1-5m", value: 38 },
        ],
        stats: [{ label: "p50", value: "2 min" }],
      }),
    );
    expect(html).toContain("0-1m");
    expect(html).toContain("p50");
  });
  it("shows an empty state with no buckets", () => {
    expect(render(Histogram({ buckets: [] }))).toContain("No data");
  });
});

describe("DotStrip", () => {
  it("renders a track per row", () => {
    const html = render(
      DotStrip({
        rows: [
          {
            label: "Explore",
            meta: "76k median",
            dots: [48, 61, 76],
            tone: "ok",
          },
        ],
        max: 320,
      }),
    );
    expect(html).toContain("Explore");
  });
  it("shows an empty state with no rows", () => {
    expect(render(DotStrip({ rows: [], max: 100 }))).toContain("No data");
  });
});

describe("KeyLegend", () => {
  it("renders each key", () => {
    const html = render(
      KeyLegend({
        items: [
          { label: "before", color: "#4299e1" },
          { label: "after", color: "#ed64a6" },
        ],
      }),
    );
    expect(html).toContain("before");
    expect(html).toContain("after");
  });
});

describe("Table", () => {
  it("renders columns and rows, applying highlight and mono", () => {
    const html = render(
      Table({
        columns: [
          { key: "tool", label: "Tool" },
          {
            key: "wall",
            label: "Wall/wk",
            align: "right",
            format: "duration_min",
          },
        ],
        rows: [{ tool: "pnpm", wall: 132 }],
        highlight: (row, key) =>
          key === "wall" && Number(row.wall) >= 60 ? "warn" : undefined,
        mono: ["tool"],
      }),
    );
    expect(html).toContain("pnpm");
    expect(html).toContain("Wall/wk");
  });
  it("shows an empty state with no rows", () => {
    expect(
      render(Table({ columns: [{ key: "a", label: "A" }], rows: [] })),
    ).toContain("No data");
  });
});

describe("ScatterDots", () => {
  it("renders with sample data", () => {
    expect(
      render(
        ScatterDots({
          data: [
            { day: 1, atK: 90, trigger: "manual" },
            { day: 2, atK: 260, trigger: "auto" },
          ],
          x: "day",
          y: "atK",
          seriesKey: "trigger",
          xIsTime: true,
        }),
      ),
    ).toBeTruthy();
  });
  it("shows an empty state with no data", () => {
    expect(render(ScatterDots({ data: [], x: "day", y: "atK" }))).toContain(
      "No data",
    );
  });
});

describe("LineChart", () => {
  it("renders lines, a band and a scatter overlay", () => {
    expect(
      render(
        LineChart({
          data: [
            { day: "Jul 1", spend: 10, low: 8, high: 14, limited: 0 },
            { day: "Jul 2", spend: 22, low: 9, high: 16, limited: 1 },
          ],
          x: "day",
          series: [{ key: "spend", label: "this week", color: "#ed8926" }],
          band: { lowKey: "low", highKey: "high" },
          dots: { key: "limited" },
          format: "cost",
        }),
      ),
    ).toBeTruthy();
  });
  it("shows an empty state with no data", () => {
    expect(
      render(LineChart({ data: [], x: "day", series: [{ key: "spend" }] })),
    ).toContain("No data");
  });
});

describe("Bars", () => {
  it("renders with per-bar colors and a reference line", () => {
    expect(
      render(
        Bars({
          data: [
            { pr: "#471", cost: 12, hot: false },
            { pr: "#474", cost: 90, hot: true },
          ],
          x: "pr",
          y: "cost",
          colorBy: (row) => (row.hot ? "#e53e3e" : "#4299e1"),
          referenceLines: [{ y: 30, label: "median", dashed: true }],
          format: "cost",
        }),
      ),
    ).toBeTruthy();
  });
  it("shows an empty state with no data", () => {
    expect(render(Bars({ data: [], x: "pr", y: "cost" }))).toContain("No data");
  });
});

describe("ComboChart", () => {
  it("renders bars and lines on dual axes", () => {
    expect(
      render(
        ComboChart({
          data: [
            { week: "wk1", prs: 3, commits: 11, cost: 120 },
            { week: "wk2", prs: 5, commits: 9, cost: 90 },
          ],
          x: "week",
          bars: [
            { key: "prs", label: "merged PRs" },
            { key: "commits", label: "commits" },
          ],
          lines: [{ key: "cost", label: "cost", axis: "right" }],
          leftFormat: "number",
          rightFormat: "cost",
        }),
      ),
    ).toBeTruthy();
  });
  it("shows an empty state with no data", () => {
    expect(
      render(ComboChart({ data: [], x: "week", bars: [], lines: [] })),
    ).toContain("No data");
  });
});

describe("Gantt", () => {
  it("renders session tracks, ticks and a density strip", () => {
    const html = render(
      Gantt({
        rows: [
          {
            label: "Session A",
            sub: "repo",
            segments: [
              { start: 540, end: 600, kind: "active" },
              { start: 600, end: 660, kind: "idle" },
            ],
            value: "$4.20",
          },
        ],
        rangeStart: 0,
        rangeEnd: 1440,
        ticks: [{ at: 720, label: "12:00" }],
        density: [0, 1, 2, 1],
        densityLabel: "in parallel",
      }),
    );
    expect(html).toContain("Session A");
    expect(html).toContain("12:00");
  });
  it("shows an empty state with no rows", () => {
    expect(
      render(Gantt({ rows: [], rangeStart: 0, rangeEnd: 1440 })),
    ).toContain("No data");
  });
});
