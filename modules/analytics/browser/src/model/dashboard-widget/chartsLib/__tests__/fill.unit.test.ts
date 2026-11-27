/**
 * A chart a widget draws with no height fills the card it sits in, so the size a new widget
 * lands at never cuts its bars off; a height the widget passes still wins.
 * @see modules/dashboard/specs/dashboards-v2.feature AC262
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AreaTimeseries, LwqlChart, ProjectionBars, StackedBars } from "../index";

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

/** Each Recharts component as its own name, so the tree says what was drawn. */
const fakeRecharts = new Proxy({}, { get: (_target, name) => String(name) });

function descendants(node: unknown): Element[] {
  if (!node || typeof node !== "object" || !("children" in node)) return [];
  const element = node as Element;
  return [element, ...element.children.flatMap(descendants)];
}

/** The element a chart returned, read as the tree the fake React builds. */
function root(node: unknown): Element {
  const [element] = descendants(node);
  if (!element) throw new Error("the chart returned no element");
  return element;
}

const containers = (node: unknown) =>
  descendants(node).filter((element) => element.type === "ResponsiveContainer");

/** The chart the auto-picker chose, drawn as the frame's React would. */
function drawPicked(node: unknown): Element {
  const picked = root(node);
  const chart = picked.type as (props: Record<string, unknown> | null) => unknown;
  return root(chart(picked.props));
}

const scope = globalThis as { window?: unknown };

const colors = Object.fromEntries(
  [
    "fg",
    "fg.subtle",
    "fg.error",
    "fg.success",
    "bg.card",
    "border.card",
    "border.muted",
    "blue.subtle",
    "blue.solid",
    ...Array.from({ length: 8 }, (_, index) => `chart.${index + 1}`),
  ].map((name) => [name, "#123456"]),
);

const rows = [
  { day: "2026-11-01 00:00:00", traces: 4 },
  { day: "2026-11-02 00:00:00", traces: 7 },
];

beforeEach(() => {
  scope.window = {
    React: fakeReact,
    Recharts: fakeRecharts,
    LW: { theme: "dark", dashboardContext: { colors } },
  };
});
afterEach(() => {
  delete scope.window;
});

describe("a chart with no height", () => {
  /** @scenario "AC262 Langy widgets: a prebuilt chart with no height fills its card" */
  it("takes the whole height of its parent, with a floor for a parent that gives none", () => {
    const area = root(AreaTimeseries({ data: rows, x: "day", series: "traces" }));

    expect(area.props?.style).toMatchObject({ height: "100%" });
    const [plot] = containers(area);
    expect(plot?.props).toMatchObject({ height: "100%", minHeight: 120 });
  });

  /** @scenario "AC262 Langy widgets: a prebuilt chart with no height fills its card" */
  it("fills for every chart the auto-picker and the bar charts draw", () => {
    const picked = drawPicked(LwqlChart({ data: rows }));
    const bars = root(StackedBars({ data: rows, x: "day", series: ["traces"] }));
    const projection = root(
      ProjectionBars({ data: rows, x: "day", y: "traces", projectionFrom: "2026-11-02 00:00:00" }),
    );

    expect(picked.props?.style).toMatchObject({ height: "100%" });
    expect(containers(picked)[0]?.props).toMatchObject({ minHeight: 120 });
    expect(bars.props?.style).toMatchObject({ height: "100%" });
    expect(containers(projection)[0]?.props).toMatchObject({ height: "100%", minHeight: 120 });
  });

  /** @scenario "AC262 Langy widgets: a prebuilt chart with no height fills its card" */
  it("keeps a height the widget passes", () => {
    const area = root(
      AreaTimeseries({
        data: rows,
        x: "day",
        series: "traces",
        height: 180,
      }),
    );

    expect(area.props?.style).toMatchObject({ height: 180 });
  });

  /** @scenario "AC262 Langy widgets: a prebuilt chart with no height fills its card" */
  it("keeps a passed height below the floor, without the fill floor", () => {
    const area = root(AreaTimeseries({ data: rows, x: "day", series: "traces", height: 80 }));
    const projection = root(
      ProjectionBars({
        data: rows,
        x: "day",
        y: "traces",
        projectionFrom: "2026-11-02 00:00:00",
        height: 80,
      }),
    );

    expect(area.props?.style).toMatchObject({ height: 80 });
    expect(containers(area)[0]?.props).not.toHaveProperty("minHeight");
    expect(containers(projection)[0]?.props).toMatchObject({ height: 80 });
    expect(containers(projection)[0]?.props).not.toHaveProperty("minHeight");
  });

  /** @scenario "AC262 Langy widgets: a prebuilt chart with no height fills its card" */
  it("keeps a passed full height without the fill floor, through the auto-picker too", () => {
    const area = root(AreaTimeseries({ data: rows, x: "day", series: "traces", height: "100%" }));
    const picked = drawPicked(LwqlChart({ data: rows, height: "100%" }));

    expect(area.props?.style).toMatchObject({ height: "100%" });
    expect(containers(area)[0]?.props).not.toHaveProperty("minHeight");
    expect(picked.props?.style).toMatchObject({ height: "100%" });
    expect(containers(picked)[0]?.props).not.toHaveProperty("minHeight");
  });
});
