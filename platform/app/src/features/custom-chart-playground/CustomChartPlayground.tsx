/**
 * The custom-chart-playground surface: persisted, sizable widgets, each a
 * sandboxed chart frame wired to the real LangWatchQL endpoint.
 *
 * "+ New widget" persists a blank widget immediately (starter code + query).
 * Widgets live in the same 2-column grid the reports dashboard uses — drag to
 * reorder, pick a size preset, delete, flip a card to Code to edit its file
 * in place, or edit both the file and its queries in a drawer. The
 * frame's bridge tears itself down after ~10s of missed heartbeats (paused
 * while the tab is hidden), so widgets stay mounted while the page is up; a
 * Save re-keys only the touched frame.
 */

import { Box, Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { SizeOption } from "~/components/analytics/reports/GraphCardMenu";
import { sizeOptions } from "~/components/analytics/reports/GraphCardMenu";
import { toaster } from "~/components/ui/toaster";
import { playgroundWidgetDefinitionSchema } from "~/server/analytics/playgroundWidgetDefinition";
import { api } from "~/utils/api";
import { calculateGridPositions, type GridLayout } from "~/utils/gridPositions";

import type { PlaygroundWidget } from "./PlaygroundWidgetCard";
import { PlaygroundWidgetGrid } from "./PlaygroundWidgetGrid";
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
}): PlaygroundWidget {
  const parsed = playgroundWidgetDefinitionSchema.safeParse(row.graph);
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

  const widgetsQuery = api.playgroundWidgets.list.useQuery(
    { projectId },
    { enabled: projectId.length > 0 },
  );

  const createWidget = api.playgroundWidgets.create.useMutation();
  const updateWidget = api.playgroundWidgets.update.useMutation();
  const deleteWidget = api.playgroundWidgets.delete.useMutation();
  const updateLayout = api.playgroundWidgets.updateLayout.useMutation();
  const batchUpdateLayouts =
    api.playgroundWidgets.batchUpdateLayouts.useMutation();

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

  const handleSizeChange = (id: string, size: SizeOption) => {
    const sizeConfig = sizeOptions.find((s) => s.value === size);
    const widget = widgets.find((w) => w.id === id);
    if (!sizeConfig || !widget) return;

    updateLayout.mutate(
      {
        projectId,
        graphId: id,
        gridColumn: widget.gridColumn,
        gridRow: widget.gridRow,
        colSpan: sizeConfig.colSpan,
        rowSpan: sizeConfig.rowSpan,
      },
      {
        onSuccess: () => {
          const updated = widgets.map((w) =>
            w.id === id
              ? {
                  ...w,
                  colSpan: sizeConfig.colSpan,
                  rowSpan: sizeConfig.rowSpan,
                }
              : w,
          );
          batchUpdateLayouts.mutate(
            { projectId, layouts: calculateGridPositions(updated) },
            { onSuccess: () => void widgetsQuery.refetch() },
          );
        },
        onError: () => showError("Error updating widget size"),
      },
    );
  };

  const handleReorder = (layouts: GridLayout[]) => {
    batchUpdateLayouts.mutate(
      { projectId, layouts },
      {
        onSuccess: () => void widgetsQuery.refetch(),
        onError: () => showError("Error reordering widgets"),
      },
    );
  };

  // Shared by every card's Code and Queries tabs, so both save the same
  // mutation and the same refetch. `onSuccess` lets the caller flip itself
  // back to Chart only once the write landed.
  const handleSave = (
    input: { id: string; code: string; queries: PlaygroundWidget["queries"] },
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
        <PlaygroundWidgetGrid
          widgets={widgets}
          projectId={projectId}
          projectSlug={projectSlug}
          onWidgetDelete={handleDelete}
          onWidgetSizeChange={handleSizeChange}
          onWidgetSave={handleSave}
          onWidgetsReorder={handleReorder}
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
