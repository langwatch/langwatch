/**
 * The charts label a UTC bucket on the reader's clock, the zone the host puts in
 * `LW.dashboardContext.timezone`, the axis tick and the hover both, when the widget's queries
 * bucket on that zone; a widget whose SQL buckets by UTC keeps UTC labels.
 * @see modules/analytics/specs/dashboard-widget-time-zone.feature
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { declaresTimeZone } from "../../params-snapshot.ts";
import { AreaTimeseries, GroupedBars, ProjectionBars, StackedBars } from "../index.ts";
import { zonedParts } from "../utc-instant.ts";

interface Element {
  type: unknown;
  props: Record<string, unknown> | null;
  children: unknown[];
}

const BUCKET = "2026-11-26 00:00:00";
const ROWS = [{ bucket: BUCKET, n: 1 }];
const globals = globalThis as Record<string, unknown>;

function frameWindow(timezone: string | undefined, isTimezoneBound = true) {
  const colors = new Proxy({}, { get: () => "#000000" });
  return {
    React: {
      createElement: (
        type: unknown,
        props: Record<string, unknown> | null,
        ...children: unknown[]
      ) => ({ type, props, children }) satisfies Element,
    },
    Recharts: new Proxy({}, { get: (_target, name) => name }),
    LW: { dashboardContext: { colors, timezone, isTimezoneBound } },
  };
}

/** Every element of a rendered tree, depth first. */
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node !== "object" || node === null || !("children" in node)) return [];
  const element = node as Element;
  return [element, ...element.children.flatMap(elements)];
}

function texts(node: unknown): string[] {
  if (typeof node === "string") return [node];
  return elements(node).flatMap((element) =>
    element.children.filter((child): child is string => typeof child === "string"),
  );
}

function chartFor(timezone: string | undefined, isTimezoneBound = true) {
  globals.window = frameWindow(timezone, isTimezoneBound);
  const tree = elements(
    AreaTimeseries({ data: [{ bucket: BUCKET, n: 1 }], x: "bucket", series: "n" }),
  );
  const axis = tree.find((element) => element.type === "XAxis");
  const tooltip = tree.find((element) => element.type === "Tooltip");
  const tick = axis?.props?.tickFormatter as (value: unknown) => string;
  const content = tooltip?.props?.content as (props: unknown) => unknown;
  const hover = content({
    active: true,
    label: BUCKET,
    payload: [{ payload: { bucket: BUCKET, n: 1 } }],
  });

  return { tick: tick(BUCKET), hover: texts(hover) };
}

let previous: unknown;
beforeEach(() => {
  previous = globals.window;
});
afterEach(() => {
  globals.window = previous;
});

describe("given a reader in America/Los_Angeles", () => {
  /** @scenario "TZ12 The charts library labels axes and tooltips on the reader's clock" */
  it("reads the axis as 16:00 and the hover as Nov 25, 16:00", () => {
    const { tick, hover } = chartFor("America/Los_Angeles");

    expect(tick).toBe("16:00");
    expect(hover).toContain("Nov 25, 16:00");
  });

  /** @scenario "TZ12 The charts library labels axes and tooltips on the reader's clock" */
  it("keeps the UTC clock when the host names no zone", () => {
    const { tick, hover } = chartFor(undefined);

    expect(tick).toBe("00:00");
    expect(hover).toContain("Nov 26");
  });

  /** @scenario "TZ12 The charts library labels axes and tooltips on the reader's clock" */
  it("falls back to UTC for a zone the runtime does not know", () => {
    const epochMs = Date.parse("2026-11-26T00:00:00Z");

    expect(zonedParts({ epochMs, timeZone: "Not/AZone" })).toMatchObject({ day: 26, hour: 0 });
    expect(zonedParts({ epochMs, timeZone: "Asia/Kolkata" })).toMatchObject({
      day: 26,
      hour: 5,
      minute: 30,
    });
  });

  /** @scenario "TZ12 The charts library labels axes and tooltips on the reader's clock" */
  it.each([
    ["StackedBars", () => StackedBars({ data: ROWS, x: "bucket", series: ["n"] })],
    ["GroupedBars", () => GroupedBars({ data: ROWS, x: "bucket", series: ["n"] })],
    [
      "ProjectionBars",
      () => ProjectionBars({ data: ROWS, x: "bucket", y: "n", projectionFrom: BUCKET }),
    ],
  ] as const)("heads the %s tooltip with the reader's clock, like its axis", (_name, render) => {
    globals.window = frameWindow("America/Los_Angeles");
    const tree = elements(render());
    const tooltip = tree.find((element) => element.type === "Tooltip");
    const label = tooltip?.props?.labelFormatter as (value: unknown) => string;

    expect(label(BUCKET)).toBe("Nov 25, 16:00");
  });

  /** @scenario "TZ12 The charts library labels axes and tooltips on the reader's clock" */
  it("dates two day buckets apart rather than reading both as midnight", () => {
    globals.window = frameWindow("UTC");
    const data = [
      { bucket: "2026-11-25 00:00:00", n: 1 },
      { bucket: "2026-11-26 00:00:00", n: 2 },
    ];
    const tree = elements(AreaTimeseries({ data, x: "bucket", series: "n" }));
    const axis = tree.find((element) => element.type === "XAxis");
    const tick = axis?.props?.tickFormatter as (value: unknown) => string;

    expect(data.map((row) => tick(row.bucket))).toEqual(["11-25", "11-26"]);
  });

  /** @scenario "TZ12 The charts library labels axes and tooltips on the reader's clock" */
  it("dates the two local midnights around the spring-forward night, 23 hours apart", () => {
    globals.window = frameWindow("America/Los_Angeles");
    const data = [
      { bucket: "2026-03-08 08:00:00", n: 1 },
      { bucket: "2026-03-09 07:00:00", n: 2 },
    ];
    const tree = elements(AreaTimeseries({ data, x: "bucket", series: "n" }));
    const axis = tree.find((element) => element.type === "XAxis");
    const tick = axis?.props?.tickFormatter as (value: unknown) => string;

    expect(data.map((row) => tick(row.bucket))).toEqual(["03-08", "03-09"]);
  });
});

describe("given a reader in America/Los_Angeles and a widget whose SQL buckets by UTC", () => {
  /** @scenario "TZ16 A widget whose queries do not bind the time zone keeps UTC labels" */
  it("labels the UTC day bucket as its own day, not the evening before", () => {
    const { tick, hover } = chartFor("America/Los_Angeles", false);

    expect(tick).toBe("00:00");
    expect(hover).toContain("Nov 26");
    expect(hover).not.toContain("Nov 25, 16:00");
  });

  /** @scenario "TZ16 A widget whose queries do not bind the time zone keeps UTC labels" */
  it("heads a bar tooltip on UTC too", () => {
    globals.window = frameWindow("America/Los_Angeles", false);
    const tree = elements(StackedBars({ data: ROWS, x: "bucket", series: ["n"] }));
    const tooltip = tree.find((element) => element.type === "Tooltip");
    const label = tooltip?.props?.labelFormatter as (value: unknown) => string;

    expect(label(BUCKET)).toBe("Nov 26");
  });
});

describe("given the queries of a widget", () => {
  /** @scenario "TZ16 A widget whose queries do not bind the time zone keeps UTC labels" */
  it.each([
    [["SELECT {dashboard_context_timezone:String} AS zone"], true],
    [["SELECT 1", "SELECT { dashboard_context_timezone : String }"], true],
    [["SELECT toStartOfInterval(OccurredAt, INTERVAL 1 DAY) FROM traces"], false],
    [["SELECT 'dashboard_context_timezone' AS name"], false],
    [[], false],
  ])("for %j, the host marks the zone bound: %s", (sqls, expected) => {
    expect(declaresTimeZone(sqls.map((sql) => ({ sql })))).toBe(expected);
  });
});
