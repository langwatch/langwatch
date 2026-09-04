/**
 * The custom-chart-playground surface: persisted, sizable widgets, each a
 * sandboxed chart frame wired to the real LangWatchQL endpoint.
 *
 * "+ New widget" persists a blank widget immediately (starter code + query).
 * Widgets live on the same grid the reports dashboard uses — drag a header to
 * move, drag a corner to resize, delete, or edit the file and its queries in
 * a drawer. The
 * frame's bridge tears itself down after ~10s of missed heartbeats (paused
 * while the tab is hidden), so widgets stay mounted while the page is up; a
 * Save re-keys only the touched frame.
 */

import { Box, Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { toaster } from "~/components/ui/toaster";
import type { ChartGridPlacement } from "~/server/analytics/chartGrid";
import { dashboardWidgetDefinitionSchema } from "~/server/analytics/dashboardWidgetDefinition";
import { api } from "~/utils/api";

import type { DashboardWidget } from "./DashboardWidgetCard";
import { DashboardWidgetGrid } from "./DashboardWidgetGrid";
import { STARTER_WIDGET_CODE, STARTER_WIDGET_QUERIES } from "./presets";

/**
 * Parses a stored `CustomGraph.graph` into the widget the grid renders.
 *
 * A row this build itself never wrote — an old shape, a hand-edited one, a
 * future version — fails `safeParse` and degrades to an empty file with no
 * queries rather than crashing the grid. Dev-only prototype surface: no
 * toast, no recovery flow, just a widget the author can overwrite.
 */
function toWidget(row: {
  id: string;
  name: string;
  graph: unknown;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  dashboardId?: string | null;
}): DashboardWidget {
  const parsed = dashboardWidgetDefinitionSchema.safeParse(row.graph);
  const definition = parsed.success ? parsed.data : { code: "", queries: [] };
  return {
    id: row.id,
    name: row.name,
    code: definition.code,
    queries: definition.queries,
    gridColumn: row.gridColumn,
    gridRow: row.gridRow,
    colSpan: row.colSpan,
    rowSpan: row.rowSpan,
    dashboardId: row.dashboardId,
  };
}

const showError = (title: string) =>
  toaster.create({ title, type: "error", duration: 3000 });

export function CustomChartPlayground({
  projectId,
  projectSlug,
  warning,
}: {
  projectId: string;
  projectSlug: string;
  warning?: string | undefined;
}) {
  // Every widget hangs off the project's first dashboard (grid rows are a
  // dashboard fact), but the playground's kind keeps them off every other
  // dashboard's builder-only reads.
  const dashboard = api.dashboards.getOrCreateFirst.useQuery(
    { projectId },
    { enabled: projectId.length > 0 },
  );
  const dashboardId = dashboard.data?.id;

  const widgetsQuery = api.dashboardWidgets.list.useQuery(
    { projectId },
    { enabled: projectId.length > 0 },
  );

  const createWidget = api.dashboardWidgets.create.useMutation();
  const updateWidget = api.dashboardWidgets.update.useMutation();
  const deleteWidget = api.dashboardWidgets.delete.useMutation();
  const batchUpdateLayouts =
    api.dashboardWidgets.batchUpdateLayouts.useMutation();

  const widgets = (widgetsQuery.data ?? []).map(toWidget);

  const handleNewWidget = () => {
    createWidget.mutate(
      {
        projectId,
        ...(dashboardId ? { dashboardId } : {}),
        name: "New widget",
        code: STARTER_WIDGET_CODE,
        queries: STARTER_WIDGET_QUERIES,
      },
      {
        onSuccess: () => void widgetsQuery.refetch(),
        onError: () => showError("Error creating widget"),
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteWidget.mutate(
      { projectId, id },
      {
        onSuccess: () => void widgetsQuery.refetch(),
        onError: () => showError("Error deleting widget"),
      },
    );
  };

  const handlePlacementChange = (placements: ChartGridPlacement[]) => {
    batchUpdateLayouts.mutate(
      { projectId, layouts: placements },
      {
        onSuccess: () => void widgetsQuery.refetch(),
        onError: () => showError("Error saving the widget layout"),
      },
    );
  };

  // Shared by every card's Code and Queries tabs, so both save the same
  // mutation and the same refetch. `onSuccess` lets the caller flip itself
  // back to Chart only once the write landed.
  const handleSave = (
    input: {
      id: string;
      name?: string;
      code: string;
      queries: DashboardWidget["queries"];
    },
    options?: { onSuccess?: () => void },
  ) => {
    updateWidget.mutate(
      { projectId, ...input },
      {
        onSuccess: () => {
          void widgetsQuery.refetch();
          options?.onSuccess?.();
        },
        onError: () => showError("Error saving widget"),
      },
    );
  };

  const hasNoWidgets = widgets.length === 0 && !widgetsQuery.isLoading;

  return (
    <VStack align="stretch" gap={4} width="full" paddingBottom={8}>
      {warning !== undefined && (
        <Box
          borderWidth="1px"
          borderColor="orange.400"
          background="orange.subtle"
          borderRadius="md"
          padding={3}
        >
          <Text fontSize="13px">{warning}</Text>
        </Box>
      )}

      <HStack justify="space-between">
        <Text fontSize="sm" color="fg.muted">
          {widgets.length} widget{widgets.length === 1 ? "" : "s"}
        </Text>
        <Button
          colorPalette="orange"
          size="sm"
          onClick={handleNewWidget}
          loading={createWidget.isPending}
        >
          <Plus /> New widget
        </Button>
      </HStack>

      {widgetsQuery.isLoading ? (
        <Skeleton height="300px" />
      ) : hasNoWidgets ? (
        <Box
          borderWidth="1px"
          borderStyle="dashed"
          borderColor="border"
          borderRadius="md"
          padding={8}
          textAlign="center"
          color="fg.muted"
        >
          <Text>No widgets yet. Click “New widget” to add one.</Text>
        </Box>
      ) : (
        <DashboardWidgetGrid
          widgets={widgets}
          projectId={projectId}
          projectSlug={projectSlug}
          onWidgetDelete={handleDelete}
          onWidgetSave={handleSave}
          onWidgetsPlacementChange={handlePlacementChange}
          deletingWidgetId={
            deleteWidget.isPending ? (deleteWidget.variables?.id ?? null) : null
          }
          savingWidgetId={
            updateWidget.isPending ? (updateWidget.variables?.id ?? null) : null
          }
        />
      )}
    </VStack>
  );
}
