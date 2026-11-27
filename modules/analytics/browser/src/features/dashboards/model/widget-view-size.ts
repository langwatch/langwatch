/**
 * How large Ask Langy draws a widget (AC121b): its card's shape, grown to read, within the room
 * the window leaves; below the smallest readable size it keeps that size and the dialog scrolls.
 */

import { CHART_GRID_MARGIN_PX } from "../../../model/chart-grid.ts";
import { boardCardHeightPx } from "./board-grid.ts";

/** A board column's width on a common screen: charts are frames with no width of their own. */
const BOARD_COLUMN_PX = 150;

/** How much larger than its card the widget is drawn, room allowing. */
const WIDGET_VIEW_GROWTH = 1.6;

/** The smallest the chart is drawn at; a smaller room scrolls it. */
export const WIDGET_VIEW_MIN_PX = { widthPx: 320, heightPx: 200 } as const;

/** What the dialog keeps around the chart: margins, padding, header and the lines under it. */
export const WIDGET_VIEW_CHROME_PX = { widthPx: 80, heightPx: 260 } as const;

/** The chart's size in the dialog. */
export interface WidgetViewSize {
  widthPx: number;
  heightPx: number;
}

/** The chart's size: the card's colSpan by rowSpan shape, as large as the room allows. */
export function widgetViewSizePx({
  colSpan,
  rowSpan,
  roomWidthPx,
  roomHeightPx,
}: {
  colSpan: number;
  rowSpan: number;
  roomWidthPx: number;
  roomHeightPx: number;
}): WidgetViewSize {
  const cardWidthPx = colSpan * BOARD_COLUMN_PX + (colSpan - 1) * CHART_GRID_MARGIN_PX;
  const cardHeightPx = boardCardHeightPx(rowSpan);
  const scale = Math.min(
    WIDGET_VIEW_GROWTH,
    roomWidthPx / cardWidthPx,
    roomHeightPx / cardHeightPx,
  );
  return {
    widthPx: Math.max(WIDGET_VIEW_MIN_PX.widthPx, Math.round(cardWidthPx * scale)),
    heightPx: Math.max(WIDGET_VIEW_MIN_PX.heightPx, Math.round(cardHeightPx * scale)),
  };
}
