/**
 * The one chart grid both the analytics dashboard (`ReportGrid`) and the
 * widget-authoring page (`DashboardWidgetGrid`) lay their cards out on: a
 * `react-grid-layout` grid in the unit `server/analytics/chartGrid.ts`
 * defines — eight fluid columns, fixed 100px rows — where a card is dragged by
 * its header and resized by its bottom-right corner, snapping to whole cells.
 *
 * Cards never overlap: the default vertical compactor pushes a neighbour down
 * when a card grows or moves into its space, and pulls everything up into any
 * gap that opens.
 *
 * A change is committed once, on drop or resize-end, as the full placement of
 * every card — a move often shifts neighbours too, and the server writes the
 * batch in one transaction. `onLayoutChange` is deliberately not used: it
 * fires on mount and on every prop change, and would write the grid back
 * each time a page opened.
 *
 * Cards are rendered per placement through `renderCard`, inside the grid
 * item element this component owns — the library matches an item to its
 * placement by the element's key, and only an element created here carries
 * the plain `graphId` as its key (`Children.map` would prefix it). A card
 * component therefore stays a plain component with no ref or grid class to
 * forward.
 *
 * @see specs/analytics/chart-grid-resize.feature
 */

import "react-grid-layout/css/styles.css";

import { Box } from "@chakra-ui/react";
import { type ReactNode, useCallback } from "react";
import {
  GridLayout,
  type Layout,
  type LayoutItem,
  useContainerWidth,
} from "react-grid-layout";
import {
  CHART_GRID_COLUMNS,
  CHART_GRID_MARGIN_PX,
  CHART_GRID_MAX_ROW_SPAN,
  CHART_GRID_ROW_HEIGHT_PX,
  type ChartGridPlacement,
} from "~/server/analytics/chartGrid";

/**
 * The class a card's header carries to be its drag handle. Only this element
 * starts a move, so a chart body — an iframe, a Recharts surface with its own
 * pointer handling — is never mistaken for one.
 */
export const CHART_GRID_DRAG_HANDLE_CLASS = "chart-grid-drag-handle";

/** A card's persisted placement, as the grid library reads it. */
export const toLayoutItem = (placement: ChartGridPlacement): LayoutItem => ({
  i: placement.graphId,
  x: placement.gridColumn,
  y: placement.gridRow,
  w: placement.colSpan,
  h: placement.rowSpan,
  // One cell is the floor in each dimension; a resize past it stops there.
  minW: 1,
  minH: 1,
  maxW: CHART_GRID_COLUMNS,
  maxH: CHART_GRID_MAX_ROW_SPAN,
});

/** The grid library's placement, back in the shape the routers persist. */
export const fromLayoutItem = (item: LayoutItem): ChartGridPlacement => ({
  graphId: item.i,
  gridColumn: item.x,
  gridRow: item.y,
  colSpan: item.w,
  rowSpan: item.h,
});

const samePlacement = ({
  a,
  b,
}: {
  a: ChartGridPlacement;
  b: ChartGridPlacement;
}): boolean =>
  a.graphId === b.graphId &&
  a.gridColumn === b.gridColumn &&
  a.gridRow === b.gridRow &&
  a.colSpan === b.colSpan &&
  a.rowSpan === b.rowSpan;

/**
 * True when two placement lists describe the same grid — used to skip a
 * commit for a drag that ended where it started.
 */
export const samePlacements = ({
  a,
  b,
}: {
  a: readonly ChartGridPlacement[];
  b: readonly ChartGridPlacement[];
}): boolean => {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((placement) => [placement.graphId, placement]));
  return a.every((placement) => {
    const other = byId.get(placement.graphId);
    return other !== undefined && samePlacement({ a: placement, b: other });
  });
};

export interface ChartGridProps {
  /** Where every card currently sits. Keyed to `children` by `graphId`. */
  placements: readonly ChartGridPlacement[];
  /**
   * Called once per finished drag or resize with the whole grid's new
   * placement, and only when something actually moved or changed size.
   */
  onPlacementsCommit: (placements: ChartGridPlacement[]) => void;
  /** The card for one placement. */
  renderCard: (placement: ChartGridPlacement) => ReactNode;
  /**
   * The grid's width, when the caller already knows it. Measured from the
   * container otherwise — tests render without layout and pass it.
   */
  width?: number;
}

export function ChartGrid({
  placements,
  onPlacementsCommit,
  renderCard,
  width: fixedWidth,
}: ChartGridProps) {
  const { width: measuredWidth, containerRef, mounted } = useContainerWidth();
  const width = fixedWidth ?? measuredWidth;

  const commit = useCallback(
    (layout: Layout) => {
      const next = layout.map(fromLayoutItem);
      if (samePlacements({ a: next, b: placements })) return;
      onPlacementsCommit(next);
    },
    [onPlacementsCommit, placements],
  );

  const layout = placements.map(toLayoutItem);

  return (
    <Box ref={containerRef} width="100%" className="chart-grid">
      {(mounted || fixedWidth !== undefined) && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: CHART_GRID_COLUMNS,
            rowHeight: CHART_GRID_ROW_HEIGHT_PX,
            margin: [CHART_GRID_MARGIN_PX, CHART_GRID_MARGIN_PX],
            containerPadding: [0, 0],
          }}
          dragConfig={{ handle: `.${CHART_GRID_DRAG_HANDLE_CLASS}` }}
          resizeConfig={{ handles: ["se"] }}
          onDragStop={commit}
          onResizeStop={commit}
        >
          {placements.map((placement) => (
            <div key={placement.graphId} className="chart-grid-item">
              {renderCard(placement)}
            </div>
          ))}
        </GridLayout>
      )}
    </Box>
  );
}
