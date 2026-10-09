/**
 * A board's stored widgets on the shared chart grid, each moved by its drag
 * handle and resized from its corner, never below the board's minimum height; a
 * finished move or resize is saved. Its rows are the board's finer 44px rows.
 */

import type { ChartGridPlacement } from "../../../../model/chart-grid.ts";
import { ChartGrid } from "../../../../ui/sections/chart-grid.tsx";
import { BOARD_GRID_ROW_HEIGHT_PX, BOARD_MIN_ROW_SPAN } from "../../model/board-grid.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { BoardWidgetCard, type WidgetCardLangy } from "./board-widget-card.tsx";

export function BoardWidgetsGrid({
  projectId,
  projectSlug,
  dashboardId,
  boardName,
  widgets,
  period,
  isWriting,
  langyFor,
  onEdit,
  onDuplicate,
  onDelete,
  onPlacementsCommit,
}: {
  projectId: string;
  projectSlug: string;
  dashboardId: string;
  boardName: string;
  widgets: readonly BoardWidget[];
  period: BoardPeriod;
  isWriting: boolean;
  /** What each card may ask Langy; absent when Langy is not available. */
  langyFor?: (widget: BoardWidget) => WidgetCardLangy;
  onEdit: (input: { widget: BoardWidget; withLangy: boolean }) => void;
  onDuplicate: (widget: BoardWidget) => void;
  onDelete: (widget: BoardWidget) => void;
  onPlacementsCommit: (placements: ChartGridPlacement[]) => void;
}) {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));

  return (
    <ChartGrid
      placements={widgets.map(({ placement }) => placement)}
      onPlacementsCommit={onPlacementsCommit}
      rowHeightPx={BOARD_GRID_ROW_HEIGHT_PX}
      minRowSpan={BOARD_MIN_ROW_SPAN}
      renderCard={({ graphId }) => {
        const widget = byId.get(graphId);
        if (!widget) return null;
        return (
          <BoardWidgetCard
            widget={widget}
            projectId={projectId}
            projectSlug={projectSlug}
            dashboardId={dashboardId}
            boardName={boardName}
            period={period}
            isWriting={isWriting}
            {...(langyFor ? { langy: langyFor(widget) } : {})}
            onEdit={({ withLangy }) => onEdit({ widget, withLangy })}
            onDuplicate={() => onDuplicate(widget)}
            onDelete={() => onDelete(widget)}
          />
        );
      }}
    />
  );
}
