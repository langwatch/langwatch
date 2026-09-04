import { useMemo, useState } from "react";
import { usePeriodSelector } from "~/components/PeriodSelector";
import { toaster } from "~/components/ui/toaster";
import type { DashboardWidgetDraft } from "~/features/custom-chart-playground/DashboardWidgetInPlaceEditor";
import { describeError } from "~/features/errors";
import { DASHBOARD_SRCDOC_CHART_KIND } from "~/server/analytics/chartKinds";
import { dashboardWidgetDefinitionSchema } from "~/server/analytics/dashboardWidgetDefinition";
import { api } from "~/utils/api";
import type { GraphData } from "./DraggableGraphCard";

/**
 * All of a dashboard-widget row's edit state: the parse of the row into an
 * editable draft, the drawer's open flag, the dashboard-period time window the
 * preview runs against, and the single mutation both the drawer's Save and the
 * card's inline rename go through. Kept out of `DraggableGraphCard` so the card
 * itself stays a thin render — the mixing of parse/mutate/cache/drawer state in
 * one place is exactly what this hook exists to own.
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
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { period } = usePeriodSelector();

  // Epoch milliseconds, not the `Date`s themselves: two `Date`s for the same
  // instant are never `Object.is`-equal, so the executor would refetch on
  // every render (the same reasoning DashboardWidgetFrame applies).
  const timeWindow = useMemo(
    () => ({
      start: period.startDate.getTime(),
      end: period.endDate.getTime(),
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

  const saveWidget = (
    draft: DashboardWidgetDraft,
    options?: { onSuccess?: () => void },
  ) => {
    updateWidget.mutate(
      { projectId, id: graph.id, ...draft },
      {
        onSuccess: () => {
          void utils.graphs.getAll.invalidate();
          void utils.dashboardWidgets.list.invalidate({ projectId });
          options?.onSuccess?.();
        },
        onError: (error) =>
          toaster.create({
            title: "Couldn't save this widget",
            description: describeError({ error }),
            type: "error",
            duration: 5000,
          }),
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
