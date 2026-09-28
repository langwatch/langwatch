/**
 * The Agent Flight Deck template's shape: ten stored widgets that each parse
 * as a widget definition, with unique keys and layouts that never overlap.
 */

import { describe, expect, it } from "vitest";

import { CHART_GRID_COLUMNS, chartGridPlacementSchema } from "../../../../model/chart-grid.ts";
import { dashboardWidgetDefinitionSchema } from "../../../../model/dashboard-widget-definition.ts";
import { AGENT_FLIGHT_DECK_TEMPLATE } from "../index.ts";

const { widgets } = AGENT_FLIGHT_DECK_TEMPLATE;

/** Every grid cell a layout covers, as "column:row". */
function cellsOf({
  gridColumn,
  gridRow,
  colSpan,
  rowSpan,
}: (typeof widgets)[number]["layout"]): string[] {
  return Array.from({ length: colSpan * rowSpan }, (_, index) => {
    const column = gridColumn + (index % colSpan);
    const row = gridRow + Math.floor(index / colSpan);
    return `${column}:${row}`;
  });
}

describe("AGENT_FLIGHT_DECK_TEMPLATE", () => {
  it("holds ten widgets", () => {
    expect(widgets).toHaveLength(10);
  });

  it("gives every widget a unique key", () => {
    expect(new Set(widgets.map((widget) => widget.key)).size).toBe(widgets.length);
  });

  it("stores every widget as a definition the widget schema accepts", () => {
    for (const widget of widgets) {
      expect(dashboardWidgetDefinitionSchema.safeParse(widget.definition).success).toBe(true);
    }
  });

  it("places every widget inside the grid", () => {
    for (const { layout } of widgets) {
      expect(chartGridPlacementSchema.safeParse(layout).success).toBe(true);
      expect(layout.gridColumn + layout.colSpan).toBeLessThanOrEqual(CHART_GRID_COLUMNS);
    }
  });

  it("never places two widgets on the same cell", () => {
    const cells = widgets.flatMap((widget) => cellsOf(widget.layout));
    expect(new Set(cells).size).toBe(cells.length);
  });
});
