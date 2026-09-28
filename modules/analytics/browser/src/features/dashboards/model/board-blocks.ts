/**
 * How a library block lives on a member's board: stored as a dashboard widget
 * whose code names the block and whose queries are the block's own LangWatchQL.
 * Pure: the translation both ways and where a new block lands on the grid.
 */

import {
  CHART_GRID_COLUMNS,
  chartGridBottomRow,
  type ChartGridPlacement,
} from "../../../model/chart-grid.ts";
import { type BlockDefinition, findBlock } from "../blocks/index.ts";

/** The first line of a stored widget's code, naming the block it draws. */
const BLOCK_MARKER = "// langwatch-dashboard-block: ";

const HALF_WIDTH = CHART_GRID_COLUMNS / 2;

/** A stored widget, as much of it as a board reads. */
export interface StoredBoardWidget {
  readonly id: string;
  readonly dashboardId: string | null;
  readonly gridColumn: number;
  readonly gridRow: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly graph: { readonly code: string };
}

/** One block placed on one board. */
export interface BoardBlock {
  readonly widgetId: string;
  readonly block: BlockDefinition;
  readonly placement: ChartGridPlacement;
}

/** A placement before the store has minted the widget's id. */
export type BlockSlot = Omit<ChartGridPlacement, "graphId">;

/**
 * What the widget store is sent for one block. The code renders a short note,
 * so the widget stays valid wherever else a widget is drawn.
 */
export function blockWidgetDefinition({ block }: { block: BlockDefinition }): {
  name: string;
  code: string;
  queries: { name: string; sql: string }[];
} {
  const note = JSON.stringify(`${block.title} is drawn on the Dashboards page.`);
  const code = [
    `${BLOCK_MARKER}${block.id}`,
    "export default function Widget() {",
    `  return <div style={{ padding: 8, fontSize: 12 }}>{${note}}</div>;`,
    "}",
    "",
  ].join("\n");
  return {
    name: block.title,
    code,
    queries: block.queries.map(({ name, sql }) => ({ name, sql })),
  };
}

/** The block a stored widget's code names, or undefined for any other widget. */
export function blockOfWidgetCode(code: string): BlockDefinition | undefined {
  const [firstLine = ""] = code.split("\n", 1);
  if (!firstLine.startsWith(BLOCK_MARKER)) return void 0;
  return findBlock(firstLine.slice(BLOCK_MARKER.length).trim());
}

/** The blocks on one board, in grid order; widgets that are not blocks are left out. */
export function boardBlocksOf({
  widgets,
  dashboardId,
}: {
  widgets: readonly StoredBoardWidget[];
  dashboardId: string;
}): BoardBlock[] {
  return widgets
    .filter((widget) => widget.dashboardId === dashboardId)
    .flatMap((widget) => {
      const block = blockOfWidgetCode(widget.graph.code);
      if (!block) return [];
      const { id, gridColumn, gridRow, colSpan, rowSpan } = widget;
      return [
        {
          widgetId: id,
          block,
          placement: { graphId: id, gridColumn, gridRow, colSpan, rowSpan },
        },
      ];
    })
    .toSorted(
      (a, b) =>
        a.placement.gridRow - b.placement.gridRow ||
        a.placement.gridColumn - b.placement.gridColumn,
    );
}

/** The size a block lands at: full or half the row, tall enough for its view. */
export function blockFootprint({ block }: { block: BlockDefinition }): {
  colSpan: number;
  rowSpan: number;
} {
  return {
    colSpan: block.width === "full" ? CHART_GRID_COLUMNS : HALF_WIDTH,
    rowSpan: block.view === "status" ? 3 : 4,
  };
}

/**
 * Where a new block goes: a half block fills the empty right half of the last
 * row when there is one, anything else starts a new row at the bottom.
 */
export function nextBlockSlot({
  placements,
  block,
}: {
  placements: readonly ChartGridPlacement[];
  block: BlockDefinition;
}): BlockSlot {
  const { colSpan, rowSpan } = blockFootprint({ block });
  const bottom = chartGridBottomRow(placements);
  const newRow = { gridColumn: 0, gridRow: bottom, colSpan, rowSpan };
  if (colSpan > HALF_WIDTH) return newRow;

  const last = placements.find(
    (placement) =>
      placement.gridColumn === 0 &&
      placement.colSpan <= HALF_WIDTH &&
      placement.gridRow + placement.rowSpan === bottom,
  );
  if (!last) return newRow;
  const rightHalfTaken = placements.some(
    (placement) =>
      placement !== last &&
      placement.gridColumn + placement.colSpan > HALF_WIDTH &&
      placement.gridRow < bottom &&
      placement.gridRow + placement.rowSpan > last.gridRow,
  );
  if (rightHalfTaken) return newRow;
  return { gridColumn: HALF_WIDTH, gridRow: last.gridRow, colSpan, rowSpan };
}
