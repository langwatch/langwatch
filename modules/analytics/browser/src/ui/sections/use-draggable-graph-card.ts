import { usePeriodSelector } from "@langwatch/analytics-browser-kit";
import { useMemo, useState } from "react";

import { analyticsApi as api } from "../../behavior/analytics-api.ts";
import { useShowErrorToast } from "../../behavior/analytics-feedback.ts";
import { DASHBOARD_SRCDOC_CHART_KIND } from "../../model/chart-kinds.ts";
import {
  dashboardWidgetDefinitionSchema,
  type DashboardWidgetDraft,
} from "../../model/dashboard-widget-definition.ts";
import type { GraphData } from "./draggable-graph-card.tsx";

/**
 * All of a dashboard-widget row's edit state: the draft, the drawer's
 * open flag, the preview's time window, and the mutation both Save and
 * inline rename share. Kept out so `DraggableGraphCard` stays a thin render.
 */
export function useDraggableGraphCard({
  graph,
  projectId,
}: {
  graph: Pick<GraphData, "id" | "name" | "graph" | "kind">;
  projectId: string;
}) {
  const utils = api.useUtils();
  const updateWidget = api.dashboardWidgets.update.useMutation();
  const showErrorToast = useShowErrorToast();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { period } = usePeriodSelector();

  // Epoch milliseconds, not the `Date`s themselves: two `Date`s for the same
  // instant are never `Object.is`-equal, so the executor would refetch on
  // every render (the same reasoning DashboardWidgetFrame applies).
  const timeWindow = useMemo(
    () => ({
      start: period.startDate.epochMilliseconds,
      end: period.endDate.epochMilliseconds,
    }),
    [period.startDate, period.endDate],
  );

  // The row as a draft seed; unparsable rows get no editor, matching the
  // frame's own "could not be read" fallback.
  const persistedWidget = useMemo((): DashboardWidgetDraft | null => {
    if (graph.kind !== DASHBOARD_SRCDOC_CHART_KIND) return null;
    const parsed = dashboardWidgetDefinitionSchema.safeParse(graph.graph);
    return parsed.success
      ? {
          name: graph.name,
          code: parsed.data.code,
          queries: parsed.data.queries,
        }
      : null;
  }, [graph.kind, graph.graph, graph.name]);

  const saveWidget = (draft: DashboardWidgetDraft, options?: { onSuccess?: () => void }) => {
    updateWidget.mutate(
      { projectId, id: graph.id, ...draft },
      {
        onSuccess: () => {
          void utils.graphs.getAll.invalidate();
          void utils.dashboardWidgets.list.invalidate({ projectId });
          options?.onSuccess?.();
        },
        onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't save this widget" }),
      },
    );
  };

  // A standalone rename, straight from the card's own title, resaves the
  // widget's CURRENT persisted code/queries, never whatever draft might be
  // sitting in the drawer, so renaming here can never smuggle in an
  // unrelated in-progress edit.
  const handleRename = (newName: string) => {
    if (!persistedWidget) return;
    saveWidget({ ...persistedWidget, name: newName });
  };

  return {
    isEditOpen,
    openEditor: () => setIsEditOpen(true),
    closeEditor: () => setIsEditOpen(false),
    timeWindow,
    persistedWidget,
    saveWidget,
    handleRename,
    isSaving: updateWidget.isPending,
  };
}
