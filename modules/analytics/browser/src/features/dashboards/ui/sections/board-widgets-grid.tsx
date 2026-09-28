/**
 * A board's stored widgets on the shared chart grid, each moved by its drag
 * handle and resized from its corner; a finished move or resize is saved.
 */

import type { ChartGridPlacement } from "../../../../model/chart-grid.ts";
import type { DashboardWidgetDraft } from "../../../../model/dashboard-widget-definition.ts";
import { ChartGrid } from "../../../../ui/sections/chart-grid.tsx";
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
