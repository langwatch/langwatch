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
  dashboardId?: string | null;
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
    dashboardId: row.dashboardId,
  };
}

const showError = (title: string) =>
  toaster.create({ title, type: "error", duration: 3000 });

/** Every widget hangs off the project's first dashboard (grid rows are a
 * dashboard fact), but the playground's kind keeps them off every other
 * dashboard's builder-only reads. */
function usePlaygroundDashboardId(projectId: string): string | undefined {
  const dashboard = api.dashboards.getOrCreateFirst.useQuery(
    { projectId },
    { enabled: projectId.length > 0 },
  );
  return dashboard.data?.id;
}

function usePlaygroundWidgetMutations() {
  return {
    createWidget: api.playgroundWidgets.create.useMutation(),
    updateWidget: api.playgroundWidgets.update.useMutation(),
    deleteWidget: api.playgroundWidgets.delete.useMutation(),
    updateLayout: api.playgroundWidgets.updateLayout.useMutation(),
    batchUpdateLayouts: api.playgroundWidgets.batchUpdateLayouts.useMutation(),
  };
}

type PlaygroundWidgetMutations = ReturnType<
  typeof usePlaygroundWidgetMutations
>;

/**
 * The size-change flow alone: resolve the target widget/size, persist the new
 * span, then re-derive and persist every widget's grid position against the
 * resized layout. Its own function purely because it is the one handler with
 * a nested mutation.
 */
function makeSizeChangeHandler(args: {
  projectId: string;
  widgets: PlaygroundWidget[];
  mutations: Pick<
    PlaygroundWidgetMutations,
    "updateLayout" | "batchUpdateLayouts"
  >;
  refetch: () => void;
}) {
  const { projectId, widgets, mutations, refetch } = args;
  return (id: string, size: SizeOption) => {
    const sizeConfig = sizeOptions.find((s) => s.value === size);
    const widget = widgets.find((w) => w.id === id);
    if (!sizeConfig || !widget) return;

    mutations.updateLayout.mutate(
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
          mutations.batchUpdateLayouts.mutate(
            { projectId, layouts: calculateGridPositions(updated) },
            { onSuccess: refetch },
          );
        },
        onError: () => showError("Error updating widget size"),
      },
    );
  };
}

/**
 * The rest of the playground's mutation handlers — new/delete/reorder/save —
 * each a thin `mutate` call with its own toast-on-error and refetch-on-success.
 */
function makePlaygroundHandlers(args: {
  projectId: string;
  dashboardId: string | undefined;
  mutations: PlaygroundWidgetMutations;
  refetch: () => void;
}) {
  const { projectId, dashboardId, mutations, refetch } = args;

  const handleNewWidget = () => {
    mutations.createWidget.mutate(
      {
        projectId,
        ...(dashboardId ? { dashboardId } : {}),
        name: "New widget",
        code: STARTER_WIDGET_CODE,
        queries: STARTER_WIDGET_QUERIES,
      },
      { onSuccess: refetch, onError: () => showError("Error creating widget") },
    );
  };

  const handleDelete = (id: string) => {
    mutations.deleteWidget.mutate(
      { projectId, id },
      { onSuccess: refetch, onError: () => showError("Error deleting widget") },
    );
  };

  const handleReorder = (layouts: GridLayout[]) => {
    mutations.batchUpdateLayouts.mutate(
      { projectId, layouts },
      {
        onSuccess: refetch,
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
    mutations.updateWidget.mutate(
      { projectId, ...input },
      {
        onSuccess: () => {
          refetch();
          options?.onSuccess?.();
        },
        onError: () => showError("Error saving widget"),
      },
    );
  };

  return { handleNewWidget, handleDelete, handleReorder, handleSave };
}

/**
 * Owns every mutation the playground page fires: create/delete/resize/
 * reorder/save, each with its own toast-on-error and its own refetch. Split
 * out of the page component so the component itself is just query + render.
 */
function usePlaygroundWidgetsController(projectId: string) {
  const dashboardId = usePlaygroundDashboardId(projectId);

  const widgetsQuery = api.playgroundWidgets.list.useQuery(
    { projectId },
    { enabled: projectId.length > 0 },
  );
  const widgets = (widgetsQuery.data ?? []).map(toWidget);
  const refetch = () => void widgetsQuery.refetch();

  const mutations = usePlaygroundWidgetMutations();
  const handleSizeChange = makeSizeChangeHandler({
    projectId,
    widgets,
    mutations,
    refetch,
  });
  const { handleNewWidget, handleDelete, handleReorder, handleSave } =
    makePlaygroundHandlers({ projectId, dashboardId, mutations, refetch });

  return {
    widgets,
    isLoading: widgetsQuery.isLoading,
    createWidget: mutations.createWidget,
    deletingWidgetId: mutations.deleteWidget.isPending
      ? (mutations.deleteWidget.variables?.id ?? null)
      : null,
    savingWidgetId: mutations.updateWidget.isPending
      ? (mutations.updateWidget.variables?.id ?? null)
      : null,
    handleNewWidget,
    handleDelete,
    handleSizeChange,
    handleReorder,
    handleSave,
  };
}

function PlaygroundWarningBanner({ warning }: { warning: string }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="orange.400"
      background="orange.subtle"
      borderRadius="md"
      padding={3}
    >
      <Text fontSize="13px">{warning}</Text>
    </Box>
  );
}

function PlaygroundEmptyState() {
  return (
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
  );
}

export function CustomChartPlayground({
  projectId,
  projectSlug,
  warning,
}: {
  projectId: string;
  projectSlug: string;
  warning?: string | undefined;
}) {
  const playground = usePlaygroundWidgetsController(projectId);
  const { widgets } = playground;
  const hasNoWidgets = widgets.length === 0 && !playground.isLoading;

  return (
    <VStack align="stretch" gap={4} width="full" paddingBottom={8}>
      {warning !== undefined && <PlaygroundWarningBanner warning={warning} />}

      <HStack justify="space-between">
        <Text fontSize="sm" color="fg.muted">
          {widgets.length} widget{widgets.length === 1 ? "" : "s"}
        </Text>
        <Button
          colorPalette="orange"
          size="sm"
          onClick={playground.handleNewWidget}
          loading={playground.createWidget.isPending}
        >
          <Plus /> New widget
        </Button>
      </HStack>

      {playground.isLoading ? (
        <Skeleton height="300px" />
      ) : hasNoWidgets ? (
        <PlaygroundEmptyState />
      ) : (
        <PlaygroundWidgetGrid
          widgets={widgets}
          projectId={projectId}
          projectSlug={projectSlug}
          onWidgetDelete={playground.handleDelete}
          onWidgetSizeChange={playground.handleSizeChange}
          onWidgetSave={playground.handleSave}
          onWidgetsReorder={playground.handleReorder}
          deletingWidgetId={playground.deletingWidgetId}
          savingWidgetId={playground.savingWidgetId}
        />
      )}
    </VStack>
  );
}
