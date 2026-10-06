/**
 * A board's stored widgets on the shared chart grid, each moved by its drag
 * handle and resized from its corner, never below the board's minimum height; a
 * finished move or resize is saved. Its rows are the board's finer 44px rows.
 */

import type { ChartGridPlacement } from "../../../../model/chart-grid.ts";
import type { DashboardWidgetDraft } from "../../../../model/dashboard-widget-definition.ts";
import { ChartGrid } from "../../../../ui/sections/chart-grid.tsx";
import { BOARD_GRID_ROW_HEIGHT_PX, BOARD_MIN_ROW_SPAN } from "../../model/board-grid.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { BoardWidgetCard } from "./board-widget-card.tsx";

export function BoardWidgetsGrid({
  projectId,
  projectSlug,
  dashboardId,
  widgets,
  period,
  isWriting,
  isSaving,
  onDuplicate,
  onDelete,
  onSave,
  onPlacementsCommit,
}: {
  projectId: string;
  projectSlug: string;
  dashboardId: string;
  widgets: readonly BoardWidget[];
  period: BoardPeriod;
  isWriting: boolean;
  isSaving: boolean;
  onDuplicate: (widget: BoardWidget) => void;
  onDelete: (widget: BoardWidget) => void;
  onSave: (input: {
    widget: BoardWidget;
    draft: DashboardWidgetDraft;
    onSaved: () => void;
  }) => void;
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
            period={period}
            isWriting={isWriting}
            isSaving={isSaving}
            onDuplicate={() => onDuplicate(widget)}
            onDelete={() => onDelete(widget)}
            onSave={({ draft, onSaved }) => onSave({ widget, draft, onSaved })}
          />
        );
      }}
    />
  );
}
