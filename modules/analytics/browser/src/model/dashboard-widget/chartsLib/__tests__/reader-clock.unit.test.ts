/**
 * The charts label a UTC bucket on the reader's clock, the zone the host puts in
 * `LW.dashboardContext.timezone`: the axis tick and the hover both.
 * @see modules/analytics/specs/dashboard-widget-time-zone.feature
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AreaTimeseries } from "../index.ts";
import { zonedParts } from "../utc-instant.ts";

interface Element {
  type: unknown;
  props: Record<string, unknown> | null;
  children: unknown[];
}

const BUCKET = "2026-11-26 00:00:00";
const globals = globalThis as Record<string, unknown>;

function frameWindow(timezone: string | undefined) {
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
    LW: { dashboardContext: { colors, timezone } },
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

function chartFor(timezone: string | undefined) {
  globals.window = frameWindow(timezone);
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
});
