/**
 * The dashboard widget grid: every widget in the project on the shared
 * `ChartGrid`, the same grid the analytics dashboard lays its cards out on.
 * Cards are dashboard widgets (sandboxed frames) rather than builder or
 * workbench graphs.
 */

import { ChartGrid } from "~/components/analytics/reports/ChartGrid";
import type { ChartGridPlacement } from "~/server/analytics/chartGrid";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";

import {
  type DashboardWidget,
  DashboardWidgetCard,
} from "./DashboardWidgetCard";

interface DashboardWidgetGridProps {
  widgets: DashboardWidget[];
  projectId: string;
  projectSlug: string;
  onWidgetDelete: (id: string) => void;
  onWidgetSave: (
    input: { id: string; code: string; queries: DashboardWidgetQuery[] },
    options?: { onSuccess?: () => void },
  ) => void;
  onWidgetsPlacementChange: (placements: ChartGridPlacement[]) => void;
  deletingWidgetId: string | null;
  savingWidgetId: string | null;
}

export function DashboardWidgetGrid({
  widgets,
  projectId,
  projectSlug,
  onWidgetDelete,
  onWidgetSave,
  onWidgetsPlacementChange,
  deletingWidgetId,
  savingWidgetId,
}: DashboardWidgetGridProps) {
  const widgetById = new Map(widgets.map((widget) => [widget.id, widget]));
  const placements = widgets.map((widget) => ({
    graphId: widget.id,
    gridColumn: widget.gridColumn,
    gridRow: widget.gridRow,
    colSpan: widget.colSpan,
    rowSpan: widget.rowSpan,
  }));

  return (
    <ChartGrid
      placements={placements}
      onPlacementsCommit={onWidgetsPlacementChange}
      renderCard={({ graphId }) => {
        const widget = widgetById.get(graphId);
        if (!widget) return null;
        return (
          <DashboardWidgetCard
            widget={widget}
            projectId={projectId}
            projectSlug={projectSlug}
            onDelete={() => onWidgetDelete(widget.id)}
            onSave={onWidgetSave}
            isDeleting={deletingWidgetId === widget.id}
            isSaving={savingWidgetId === widget.id}
          />
        );
      }}
    />
  );
}
