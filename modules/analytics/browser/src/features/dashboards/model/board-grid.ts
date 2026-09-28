/**
 * A board lays its cards on a finer grid than the analytics dashboard: 44px rows,
 * so a card can take the height its content needs, as a status strip three rows tall.
 */

import { CHART_GRID_MARGIN_PX } from "../../../model/chart-grid.ts";

/** The height of one board grid row, in px. */
export const BOARD_GRID_ROW_HEIGHT_PX = 44;

/** The rendered height of a board card spanning `rowSpan` rows, the gaps between included. */
export const boardCardHeightPx = (rowSpan: number): number =>
  rowSpan * BOARD_GRID_ROW_HEIGHT_PX + (rowSpan - 1) * CHART_GRID_MARGIN_PX;
