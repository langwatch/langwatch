/**
 * The stored widgets on one board, in grid order, and where a copy of one
 * lands. Every widget is an ordinary `dashboardWidgets` row. Pure.
 */

import { chartGridBottomRow, type ChartGridPlacement } from "../../../model/chart-grid.ts";
import type { DashboardWidgetDefinition } from "../../../model/dashboard-widget-definition.ts";

/** A stored widget, as much of it as a board reads. */
export interface StoredBoardWidget {
  readonly id: string;
  readonly name: string;
  readonly dashboardId: string | null;
  readonly gridColumn: number;
  readonly gridRow: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly graph: DashboardWidgetDefinition;
}

/** One widget placed on one board. */
export interface BoardWidget {
  readonly id: string;
  readonly name: string;
  readonly definition: DashboardWidgetDefinition;
  readonly placement: ChartGridPlacement;
}

/** The widgets on one board, top to bottom, left to right. */
export function boardWidgetsOf({
  widgets,
  dashboardId,
}: {
  widgets: readonly StoredBoardWidget[];
  dashboardId: string;
}): BoardWidget[] {
  return widgets
    .filter((widget) => widget.dashboardId === dashboardId)
    .map(({ id, name, graph, gridColumn, gridRow, colSpan, rowSpan }) => ({
      id,
      name,
      definition: graph,
      placement: { graphId: id, gridColumn, gridRow, colSpan, rowSpan },
    }))
    .toSorted(
      (a, b) =>
        a.placement.gridRow - b.placement.gridRow ||
        a.placement.gridColumn - b.placement.gridColumn,
    );
}

/** A copy keeps the original's size and starts a new row at the bottom of the board. */
export function duplicateSlot({
  placements,
  original,
}: {
  placements: readonly ChartGridPlacement[];
  original: ChartGridPlacement;
}): Omit<ChartGridPlacement, "graphId"> {
  return {
    gridColumn: 0,
    gridRow: chartGridBottomRow(placements),
    colSpan: original.colSpan,
    rowSpan: original.rowSpan,
  };
}
