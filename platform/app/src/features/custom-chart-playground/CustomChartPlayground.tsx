/**
 * The custom-chart-playground surface: persisted, sizable widgets, each a
 * sandboxed chart frame wired to the real LangWatchQL endpoint.
 *
 * "+ New widget" persists a blank widget immediately (starter HTML + SQL).
 * Widgets live in the same 2-column grid the reports dashboard uses — drag to
 * reorder, pick a size preset, delete, or edit the HTML/SQL in a drawer. The
 * frame's bridge tears itself down 1.5s after its last heartbeat, so widgets
 * stay mounted while the page is up; a Save re-keys only the touched frame.
 */

import { Box, Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { SizeOption } from "~/components/analytics/reports/GraphCardMenu";
import { sizeOptions } from "~/components/analytics/reports/GraphCardMenu";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import { calculateGridPositions, type GridLayout } from "~/utils/gridPositions";

import type { PlaygroundWidget } from "./PlaygroundWidgetCard";
import { PlaygroundWidgetEditDrawer } from "./PlaygroundWidgetEditDrawer";
import { PlaygroundWidgetGrid } from "./PlaygroundWidgetGrid";
import { STARTER_WIDGET_HTML, STARTER_WIDGET_SQL } from "./presets";

/** Parses a stored `CustomGraph.graph` into the widget the grid renders. */
function toWidget(row: {
  id: string;
  name: string;
  graph: unknown;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}): PlaygroundWidget {
  const graph = (row.graph ?? {}) as { srcdocHtml?: string; sql?: string };
  return {
    id: row.id,
    name: row.name,
    srcdocHtml: graph.srcdocHtml ?? "",
    sql: graph.sql ?? "",
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
  const [editingId, setEditingId] = useState<string | null>(null);

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
  const editingWidget = widgets.find((w) => w.id === editingId) ?? null;

  const handleNewWidget = () => {
    createWidget.mutate(
      {
        projectId,
        ...(dashboardId ? { dashboardId } : {}),
        name: "New widget",
        srcdocHtml: STARTER_WIDGET_HTML,
        sql: STARTER_WIDGET_SQL,
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

  const handleSave = (input: {
    id: string;
    srcdocHtml: string;
    sql: string;
  }) => {
    updateWidget.mutate(
      { projectId, ...input },
      {
        onSuccess: () => {
          setEditingId(null);
          void widgetsQuery.refetch();
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
          onWidgetEdit={setEditingId}
          onWidgetsReorder={handleReorder}
          deletingWidgetId={
            deleteWidget.isPending ? (deleteWidget.variables?.id ?? null) : null
          }
        />
      )}

      <PlaygroundWidgetEditDrawer
        widget={editingWidget}
        onClose={() => setEditingId(null)}
        onSave={handleSave}
        isSaving={updateWidget.isPending}
      />
    </VStack>
  );
}
