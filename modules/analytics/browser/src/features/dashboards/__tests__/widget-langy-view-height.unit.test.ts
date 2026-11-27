/**
 * How large Ask Langy draws a widget: its card's shape, within the room the window leaves.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { WIDGET_VIEW_MIN_PX, widgetViewSizePx } from "../model/widget-view-size.ts";

const ROOMY = { roomWidthPx: 4_000, roomHeightPx: 4_000 };
const aspect = ({ widthPx, heightPx }: { widthPx: number; heightPx: number }) => widthPx / heightPx;

describe("the widget's size in the Ask Langy dialog", () => {
  /** @scenario "A short widget stays short beside Langy" */
  it("keeps a short, wide card short and wide", () => {
    const strip = widgetViewSizePx({ colSpan: 8, rowSpan: 3, ...ROOMY });

    expect(strip.heightPx).toBeLessThan(300);
    expect(aspect(strip)).toBeGreaterThan(5);
  });

  /** @scenario "AC121b Ask Langy: clicking opens the widget in a centred dialog shaped like its card" */
  it("keeps the card's shape, grown to read, when the room allows", () => {
    const half = widgetViewSizePx({ colSpan: 4, rowSpan: 6, ...ROOMY });
    const tall = widgetViewSizePx({ colSpan: 2, rowSpan: 9, ...ROOMY });

    expect(half.widthPx).toBeGreaterThan(4 * 150);
    expect(aspect(half)).toBeGreaterThan(1);
    expect(aspect(tall)).toBeLessThan(1);
  });

  /** @scenario "AC121b Ask Langy: clicking opens the widget in a centred dialog shaped like its card" */
  it("is never wider or taller than the room, and keeps the shape when it shrinks", () => {
    const roomy = widgetViewSizePx({ colSpan: 4, rowSpan: 6, ...ROOMY });
    const narrow = widgetViewSizePx({
      colSpan: 4,
      rowSpan: 6,
      roomWidthPx: 700,
      roomHeightPx: 4_000,
    });
    const low = widgetViewSizePx({ colSpan: 4, rowSpan: 6, roomWidthPx: 4_000, roomHeightPx: 300 });

    expect(narrow.widthPx).toBe(700);
    expect(low.heightPx).toBe(300);
    expect(aspect(narrow)).toBeCloseTo(aspect(roomy), 1);
    expect(aspect(low)).toBeCloseTo(aspect(roomy), 1);
  });

  /** @scenario "AC121c Ask Langy: in a room smaller than the smallest readable chart, the dialog scrolls" */
  it("keeps the smallest readable size in a room smaller than it", () => {
    const size = widgetViewSizePx({ colSpan: 4, rowSpan: 6, roomWidthPx: 200, roomHeightPx: 120 });

    expect(size).toEqual(WIDGET_VIEW_MIN_PX);
  });
});
