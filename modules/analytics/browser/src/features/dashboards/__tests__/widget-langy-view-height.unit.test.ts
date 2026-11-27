/**
 * How tall the widget is drawn beside Langy, from its card's body height.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import { describe, expect, it } from "vitest";

import {
  WIDGET_VIEW_CHART_HEIGHT_PX,
  widgetViewChartHeightPx,
} from "../ui/sections/widget-langy-view.tsx";

describe("the widget's height beside Langy", () => {
  /** @scenario "A short widget stays short beside Langy" */
  it("grows a short card's body instead of drawing it at the full cap", () => {
    expect(widgetViewChartHeightPx(120)).toBe(192);
    expect(widgetViewChartHeightPx(1000)).toBe(WIDGET_VIEW_CHART_HEIGHT_PX);
  });
});
