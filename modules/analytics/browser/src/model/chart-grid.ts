/**
 * The chart grid's own unit, shared by server-side layout validation and the
 * frontend `ChartGrid.tsx`: both must agree, or a layout valid on one side gets rejected.
 * @see specs/analytics/chart-grid-resize.feature
 */

import { z } from "zod";

/** How many columns wide the grid is. A card's `colSpan` is 1..this. */
export const CHART_GRID_COLUMNS = 8;

/** The fixed pixel height of one grid row. */
export const CHART_GRID_ROW_HEIGHT_PX = 100;

/** The gap between cards, in px, on both axes. */
export const CHART_GRID_MARGIN_PX = 16;

/**
 * The tallest a single card may be, in rows. Generous rather than exact —
 * this is a sanity ceiling against a stray drag or a malformed request, not a
 * design opinion about how tall a chart should be.
 */
export const CHART_GRID_MAX_ROW_SPAN = 20;

/**
 * The size a chart lands at when nothing chose one: half the row wide and
 * three rows tall — the same footprint the old grid's single default cell had.
 */
export const CHART_GRID_DEFAULT_COL_SPAN = 4;
export const CHART_GRID_DEFAULT_ROW_SPAN = 3;

/**
 * The ceiling a grid row may carry. Far beyond any real dashboard, but within
 * Postgres's Int range — a larger value would overflow the column into a
 * generic 500 instead of a named validation refusal.
 */
export const CHART_GRID_MAX_ROW = 2_000_000_000;

/** Where one card sits on the grid, as the routers persist it. */
export interface ChartGridPlacement {
  graphId: string;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}

/**
 * One card's placement as a request may carry it. Every router that writes
 * the grid validates against this, so the bounds live in exactly one place.
 */
export const chartGridPlacementSchema = z.object({
  gridColumn: z
    .number()
    .int()
    .min(0)
    .max(CHART_GRID_COLUMNS - 1),
  gridRow: z.number().int().min(0).max(CHART_GRID_MAX_ROW),
  colSpan: z.number().int().min(1).max(CHART_GRID_COLUMNS),
  rowSpan: z.number().int().min(1).max(CHART_GRID_MAX_ROW_SPAN),
});

/** True when a column/span pair stays inside the grid's right edge. */
export const fitsChartGridWidth = ({
  gridColumn,
  colSpan,
}: {
  gridColumn: number;
  colSpan: number;
}): boolean => gridColumn + colSpan <= CHART_GRID_COLUMNS;

/**
 * The rendered height of a card spanning `rowSpan` rows: the rows themselves
 * plus the gaps between them, which the card also covers.
 */
export const chartGridCardHeightPx = (rowSpan: number): number =>
  rowSpan * CHART_GRID_ROW_HEIGHT_PX + (rowSpan - 1) * CHART_GRID_MARGIN_PX;

/**
 * The first row below every card listed, so a new card sits under the
 * existing ones. A card ends at `gridRow + rowSpan`, so the bottom is the
 * largest of those, or row 0 when the grid is empty.
 */
export const chartGridBottomRow = (
  cards: readonly { gridRow: number; rowSpan: number }[],
): number => cards.reduce((bottom, card) => Math.max(bottom, card.gridRow + card.rowSpan), 0);

/**
 * New cards all land at column 0 on the bottom row, leaving the right half
 * empty. A pure left-edge stack of half-width-or-less cards flows left to
 * right in reading order; any other layout is deliberate and returned as is.
 */
export const reflowSingleColumnStack = <T extends Omit<ChartGridPlacement, "graphId">>(
  cards: readonly T[],
): readonly T[] => {
  const isStack =
    cards.length > 1 &&
    cards.every(({ gridColumn, colSpan }) => gridColumn === 0 && colSpan * 2 <= CHART_GRID_COLUMNS);
  if (!isStack) return cards;
  const ordered = cards.toSorted((a, b) => a.gridRow - b.gridRow);
  let column = 0;
  let row = ordered[0]!.gridRow;
  let rowBottom = row;
  const placed = new Map<T, T>();
  for (const card of ordered) {
    if (!fitsChartGridWidth({ gridColumn: column, colSpan: card.colSpan })) {
      column = 0;
      row = rowBottom;
    }
    placed.set(card, { ...card, gridColumn: column, gridRow: row });
    column += card.colSpan;
    rowBottom = Math.max(rowBottom, row + card.rowSpan);
  }
  return cards.map((card) => placed.get(card) ?? card);
};
