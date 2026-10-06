/**
 * The stored widgets on one board, in grid order, and where a copy of one
 * lands, alone or with its whole board. Every widget is an ordinary `dashboardWidgets` row. Pure.
 */

import { chartGridBottomRow, type ChartGridPlacement } from "../../../model/chart-grid.ts";
import type { DashboardWidgetDefinition } from "../../../model/dashboard-widget-definition.ts";
import type { BoardTemplateWidget } from "../templates/index.ts";
import { atLeastBoardMinRows } from "./board-grid.ts";

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

/** The widgets on one board, top to bottom, left to right, none shorter than the minimum. */
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
      placement: atLeastBoardMinRows({ graphId: id, gridColumn, gridRow, colSpan, rowSpan }),
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

/** One added widget's layout, before the created widget's id is known. */
type WidgetSlot = Omit<ChartGridPlacement, "graphId">;

/**
 * Where a run of template widgets lands when added to a board: below what is
 * there already, keeping the widgets' columns and their layout relative to each
 * other, with the topmost dropped flush to the board's bottom row (no gap).
 */
export function addedWidgetSlots({
  placements,
  widgets,
}: {
  placements: readonly ChartGridPlacement[];
  widgets: readonly { layout: WidgetSlot }[];
}): WidgetSlot[] {
  const bottom = chartGridBottomRow(placements);
  const topRow = Math.min(...widgets.map(({ layout }) => layout.gridRow));
  return widgets.map(({ layout }) => ({
    gridColumn: layout.gridColumn,
    gridRow: layout.gridRow - topRow + bottom,
    colSpan: layout.colSpan,
    rowSpan: layout.rowSpan,
  }));
}

/** A board's widgets as a duplicate is made from them: each at the same place. */
export function boardCopyWidgets(widgets: readonly BoardWidget[]): BoardTemplateWidget[] {
  return widgets.map(({ id, name, definition, placement }) => ({
    key: id,
    name,
    definition,
    layout: {
      gridColumn: placement.gridColumn,
      gridRow: placement.gridRow,
      colSpan: placement.colSpan,
      rowSpan: placement.rowSpan,
    },
  }));
}
