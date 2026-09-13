/**
 * The chart grid's own unit — shared by the server-side layout validation
 * (`graphs.ts`, `dashboardWidgets.ts` and the saved-workbench-chart placement
 * schema) and the frontend grid that renders it (`ChartGrid.tsx`). Both sides
 * must agree on these numbers or a layout a client considers valid would be
 * rejected by the server, or vice versa.
 *
 * A column is a fraction of the grid's own width — {@link CHART_GRID_COLUMNS}
 * of them span the full row — and a row is a fixed
 * {@link CHART_GRID_ROW_HEIGHT_PX} regardless of container width, the same
 * fluid-column/fixed-row model `react-grid-layout` (and most dashboard grids
 * modelled on it, e.g. Grafana's) default to.
 *
 * Existing rows were converted to this unit once, by the
 * `chart_grid_eight_columns` Prisma migration; nothing here converts at read
 * time.
 *
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
 * The first row below every card listed — where a new card goes so it sits
 * under the existing ones rather than on top of the tallest. A card ends at
 * `gridRow + rowSpan`, so the bottom is the largest of those, or row 0 when
 * the grid is empty.
 */
export const chartGridBottomRow = (
  cards: ReadonlyArray<{ gridRow: number; rowSpan: number }>,
): number =>
  cards.reduce(
    (bottom, card) => Math.max(bottom, card.gridRow + card.rowSpan),
    0,
  );
