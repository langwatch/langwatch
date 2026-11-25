/**
 * The blank widget "I'll build it myself" opens the editor on: the starter chart of traces
 * per bucket, which lands half wide below everything on the board once saved. Pure.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import {
  CHART_GRID_DEFAULT_COL_SPAN,
  chartGridBottomRow,
  type ChartGridPlacement,
} from "../../../model/chart-grid.ts";
import type { DashboardWidgetDraft } from "../../../model/dashboard-widget-draft.ts";
import {
  STARTER_WIDGET_CODE,
  STARTER_WIDGET_QUERIES,
} from "../../../model/dashboard-widget/presets.ts";
import { BOARD_WIDGET_DEFAULT_ROW_SPAN } from "./board-grid.ts";

/** What the editor starts a new widget from. */
export const BLANK_WIDGET: DashboardWidgetDraft = {
  name: "New widget",
  code: STARTER_WIDGET_CODE,
  queries: STARTER_WIDGET_QUERIES,
};

/** Where a new widget lands: the left half of a new row at the bottom of the board. */
export function blankWidgetSlot(
  placements: readonly ChartGridPlacement[],
): Omit<ChartGridPlacement, "graphId"> {
  return {
    gridColumn: 0,
    gridRow: chartGridBottomRow(placements),
    colSpan: CHART_GRID_DEFAULT_COL_SPAN,
    rowSpan: BOARD_WIDGET_DEFAULT_ROW_SPAN,
  };
}
