import { Box, Card } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { usePeriodSelector } from "~/components/PeriodSelector";
import { toaster } from "~/components/ui/toaster";
import { LangWatchQLDashboardWidget } from "~/features/analytics-query/components/LangWatchQLDashboardWidget";
import { DashboardWidgetFrame } from "~/features/custom-chart-playground/DashboardWidgetFrame";
import {
  type DashboardWidgetDraft,
  DashboardWidgetInPlaceEditor,
} from "~/features/custom-chart-playground/DashboardWidgetInPlaceEditor";
import { describeError } from "~/features/errors";
import { chartGridCardHeightPx } from "~/server/analytics/chartGrid";
import {
  DASHBOARD_SRCDOC_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
} from "~/server/analytics/chartKinds";
import { dashboardWidgetDefinitionSchema } from "~/server/analytics/dashboardWidgetDefinition";
import type { LangWatchQLGranularityStep } from "~/server/analytics/lwql/timeWindow";
import type { FilterField } from "~/server/filters/types";
import { api } from "~/utils/api";
import { GraphCardHeader } from "./GraphCardHeader";

interface GraphData {
  id: string;
  name: string;
  graph: unknown;
  filters: unknown;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  /**
   * Which kind of chart this row is. Absent on rows read by a caller that does
   * not select it, which reads as a builder graph — the kind every row was
   * before the discriminator existed.
   */
  kind?: string | null;
  /**
   * The datapoint step a placed workbench chart was given, in seconds. Only
   * meaningful for `workbench_sql` rows.
   */
  granularitySeconds?: LangWatchQLGranularityStep | null;
  trigger?: {
    id: string;
    active: boolean;
    alertType: string | null;
  } | null;
}

interface DraggableGraphCardProps {
  graph: GraphData;
  projectSlug: string;
  projectId: string;
  dashboardId?: string;
  onDelete: () => void;
  onGranularityChange?: (granularitySeconds: number) => void;
  isDeleting: boolean;
}

export function DraggableGraphCard({
  graph,
  projectSlug,
  projectId,
  dashboardId,
  onDelete,
  onGranularityChange,
  isDeleting,
}: DraggableGraphCardProps) {
  const isWorkbenchChart = graph.kind === WORKBENCH_SQL_CHART_KIND;
  const isDashboardWidget = graph.kind === DASHBOARD_SRCDOC_CHART_KIND;

  // A dashboard widget is edited in place: the menu's Edit opens the same
  // drawer the create flow uses, over this exact row's `graph` column. Every
  // write (a rename from the title, a save from the drawer) goes through one
  // mutation and one pair of invalidations.
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
    if (!isDashboardWidget) return null;
    const parsed = dashboardWidgetDefinitionSchema.safeParse(graph.graph);
    return parsed.success
      ? {
          name: graph.name,
          code: parsed.data.code,
          queries: parsed.data.queries,
        }
      : null;
  }, [isDashboardWidget, graph.graph, graph.name]);

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

  return (
    <Box height="full" minWidth={0}>
      <Card.Root
        height="full"
        minWidth={0}
        borderRadius="xl"
        boxShadow="0 1px 2px rgba(16,16,32,0.04)"
      >
        <Card.Body
          height="full"
          display="flex"
          flexDirection="column"
          minWidth={0}
          overflow="hidden"
          paddingX={4}
          paddingTop="10px"
          paddingBottom={3}
        >
          <GraphCardHeader
            graphId={graph.id}
            name={graph.name}
            graph={graph.graph}
            projectId={projectId}
            projectSlug={projectSlug}
            dashboardId={dashboardId}
            filters={graph.filters}
            trigger={graph.trigger}
            isWorkbenchChart={isWorkbenchChart}
            isDashboardWidget={isDashboardWidget}
            {...(graph.granularitySeconds == null
              ? {}
              : { granularitySeconds: graph.granularitySeconds })}
            {...(persistedWidget
              ? { onRename: handleRename, onEdit: () => setIsEditOpen(true) }
              : {})}
            {...(onGranularityChange ? { onGranularityChange } : {})}
            onDelete={onDelete}
            isDeleting={isDeleting}
          />

          <Box flex={1} minHeight={0}>
            <GraphCardChartArea
              graph={graph}
              projectId={projectId}
              projectSlug={projectSlug}
              dashboardId={dashboardId}
            />
          </Box>
        </Card.Body>
      </Card.Root>

      {persistedWidget && (
        <DashboardWidgetInPlaceEditor
          open={isEditOpen}
          id={graph.id}
          widget={persistedWidget}
          projectId={projectId}
          projectSlug={projectSlug}
          timeWindow={timeWindow}
          isSaving={updateWidget.isPending}
          onClose={() => setIsEditOpen(false)}
          onSave={saveWidget}
        />
      )}
    </Box>
  );
}

/**
 * The room the card's row span leaves its chart: the card's height less the
 * header row and the body's own padding.
 */
const CARD_CHROME_PX = 64;
const chartHeightPx = (rowSpan: number): number =>
  Math.max(chartGridCardHeightPx(rowSpan) - CARD_CHROME_PX, 60);

/**
 * The card's chart, routed by the row's kind: a placed workbench chart mounts
 * the live LangWatchQL widget, a dashboard widget mounts its sandboxed
 * frame, and every other row is a builder graph.
 */
function GraphCardChartArea({
  graph,
  projectId,
  projectSlug,
  dashboardId,
}: {
  graph: GraphData;
  projectId: string;
  projectSlug: string;
  dashboardId?: string;
}) {
  if (graph.kind === WORKBENCH_SQL_CHART_KIND) {
    return (
      <LangWatchQLDashboardWidget
        key={graph.id}
        chartId={graph.id}
        projectId={projectId}
        {...(graph.granularitySeconds == null
          ? {}
          : { granularitySeconds: graph.granularitySeconds })}
        name={graph.name}
      />
    );
  }

  if (graph.kind === DASHBOARD_SRCDOC_CHART_KIND) {
    return (
      <DashboardWidgetFrame
        key={graph.id}
        id={graph.id}
        graph={graph.graph}
        projectId={projectId}
        projectSlug={projectSlug}
        dashboardId={dashboardId}
        widgetName={graph.name}
        maxHeight={chartHeightPx(graph.rowSpan)}
      />
    );
  }

  return (
    <CustomGraph
      key={graph.id}
      input={{
        ...(graph.graph as CustomGraphInput),
        // Height follows the card's row span.
        height: chartHeightPx(graph.rowSpan),
      }}
      filters={
        graph.filters as
          | Record<FilterField, string[] | Record<string, string[]>>
          | undefined
      }
    />
  );
}

export type { GraphData };
