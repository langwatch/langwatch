import { Alert, Box, Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FilterSidebar } from "../../ui/sections/filter-sidebar";
import { useFilterToggle } from "../../behavior/use-filter-toggle";
import AnalyticsLayout from "../../ui/sections/analytics-layout";
import { useWidgetGranularity } from "../../behavior/use-widget-granularity";
import { analyticsApi } from "../../behavior/analytics-api";
import { calculateGridPositions, type GridLayout } from "../../model/grid-positions";
import { type SizeOption, sizeOptions } from "../../ui/sections/graph-card-menu";
import { ReportGrid } from "../../ui/sections/report-grid";
import { Link } from "../../ui/elements/analytics-link";
import { useAnalyticsHost } from "../../model/analytics-host";

function ReportsContent() {
  const host = useAnalyticsHost();
  const project = host.project();
  const { showFilters } = useFilterToggle();
  const projectId = project?.id ?? "";

  // Which dashboard the address names, or the project's first one.
  const urlDashboardId = host.route().query.dashboard;

  // Get or create first dashboard
  const getOrCreateFirst = analyticsApi.dashboards.getOrCreateFirst.useQuery(
    { projectId },
    { enabled: !!projectId && !urlDashboardId },
  );

  const activeDashboardId = urlDashboardId ?? getOrCreateFirst.data?.id;

  // Fetch all dashboards to get current dashboard name
  const dashboardsQuery = analyticsApi.dashboards.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const currentDashboard = dashboardsQuery.data?.find((d) => d.id === activeDashboardId);
  const dashboardTitle = currentDashboard?.name ?? "Reports";

  // Graphs for the active dashboard
  const graphsQuery = analyticsApi.graphs.getAll.useQuery(
    { projectId, dashboardId: activeDashboardId },
    { enabled: !!projectId && !!activeDashboardId },
  );

  const deleteGraph = analyticsApi.graphs.delete.useMutation();
  const updateLayout = analyticsApi.graphs.updateLayout.useMutation();
  const batchUpdateLayouts = analyticsApi.graphs.batchUpdateLayouts.useMutation();
  const renameDashboard = analyticsApi.dashboards.rename.useMutation();

  const handleTitleSave = (newTitle: string) => {
    if (activeDashboardId) {
      renameDashboard.mutate(
        { projectId, dashboardId: activeDashboardId, name: newTitle },
        {
          onSuccess: () => {
            void dashboardsQuery.refetch();
          },
          onError: (error: unknown) =>
            host.failed({ error, fallbackTitle: "Error renaming dashboard" }),
        },
      );
    }
  };

  const handleGraphDelete = (graphId: string) => {
    deleteGraph.mutate(
      { projectId, id: graphId },
      {
        onSuccess: () => {
          void graphsQuery.refetch();
        },
        onError: (error: unknown) => host.failed({ error, fallbackTitle: "Error deleting graph" }),
      },
    );
  };

  const handleGraphSizeChange = (graphId: string, size: SizeOption) => {
    const sizeConfig = sizeOptions.find((option) => option.value === size);
    if (!sizeConfig) return;

    const graph = graphsQuery.data?.find((g) => g.id === graphId);
    if (!graph) return;

    // Update this graph's size
    updateLayout.mutate(
      {
        projectId,
        graphId,
        gridColumn: graph.gridColumn,
        gridRow: graph.gridRow,
        colSpan: sizeConfig.colSpan,
        rowSpan: sizeConfig.rowSpan,
      },
      {
        onSuccess: () => {
          // Recalculate all positions after size change
          const updatedGraphs = graphsQuery.data?.map((g) =>
            g.id === graphId
              ? {
                  ...g,
                  colSpan: sizeConfig.colSpan,
                  rowSpan: sizeConfig.rowSpan,
                }
              : g,
          );

          if (updatedGraphs) {
            const newLayouts = calculateGridPositions(updatedGraphs);
            batchUpdateLayouts.mutate(
              { projectId, layouts: newLayouts },
              {
                onSuccess: () => {
                  void graphsQuery.refetch();
                },
              },
            );
          }
        },
        onError: (error: unknown) =>
          host.failed({ error, fallbackTitle: "Error updating graph size" }),
      },
    );
  };

  const handleGraphsReorder = (layouts: GridLayout[]) => {
    batchUpdateLayouts.mutate(
      { projectId, layouts },
      {
        onSuccess: () => {
          void graphsQuery.refetch();
        },
        onError: (error: unknown) =>
          host.failed({ error, fallbackTitle: "Error reordering graphs" }),
      },
    );
  };

  // The datapoint step each workbench widget runs at, keyed by chart id, held
  // in URL state beside the period.
  //
  // Not a stored column: `CustomGraph` has no `granularitySeconds` field, and
  // adding one is a migration this slice does not own. Not component state
  // either — that would lose the pick on reload and leave it out of a shared
  // link, so a member who coarsened a card to read it would send a colleague a
  // different chart from the one they were describing. Persisting per member
  // is the follow-up that adds the column.
  const { granularityByGraphId, setGranularity } = useWidgetGranularity();

  const handleGraphGranularityChange = ({
    graphId,
    granularitySeconds,
  }: {
    graphId: string;
    granularitySeconds: number;
  }) => {
    setGranularity(graphId, granularitySeconds);
  };

  const graphs = (graphsQuery.data ?? []).map((graph) => {
    const picked = granularityByGraphId[graph.id];
    return picked === undefined ? graph : { ...graph, granularitySeconds: picked };
  });
  const hasNoGraphs = graphs.length === 0 && !graphsQuery.isLoading;

  // Build add chart URL with current dashboard
  const addChartUrl = activeDashboardId
    ? `/${project?.slug}/analytics/custom?dashboard=${activeDashboardId}`
    : `/${project?.slug}/analytics/custom`;

  return (
    <AnalyticsLayout
      railEntry="reports"
      title={dashboardTitle}
      analyticsHeaderProps={{
        isEditable: true,
        onTitleSave: handleTitleSave,
      }}
      extraHeaderButtons={
        project ? (
          <Link href={addChartUrl} asChild>
            <Button colorPalette="orange" size="sm">
              <Plus /> Add chart
            </Button>
          </Link>
        ) : null
      }
    >
      {/* Empty state */}
      {hasNoGraphs && (
        <Alert.Root
          status="info"
          borderStartWidth="4px"
          borderStartColor="colorPalette.solid"
          marginBottom={6}
        >
          <Alert.Indicator alignSelf="start" />
          <VStack align="start">
            <Alert.Title>Add your custom graphs here</Alert.Title>
            <Alert.Description>
              <Text as="span">
                You haven{"'"}t set up any custom graphs yet. Click + Add chart to get started.
              </Text>
            </Alert.Description>
          </VStack>
        </Alert.Root>
      )}

      {/* Main content */}
      <HStack align="start" gap={6} width="full">
        <Box flex={1}>
          {graphsQuery.isLoading ? (
            <Skeleton height="300px" />
          ) : (
            <ReportGrid
              graphs={graphs}
              projectSlug={project?.slug ?? ""}
              projectId={projectId}
              dashboardId={activeDashboardId ?? undefined}
              onGraphDelete={handleGraphDelete}
              onGraphSizeChange={handleGraphSizeChange}
              onGraphGranularityChange={handleGraphGranularityChange}
              onGraphsReorder={handleGraphsReorder}
              deletingGraphId={deleteGraph.isPending ? (deleteGraph.variables?.id ?? null) : null}
            />
          )}
        </Box>
        {showFilters ? <FilterSidebar /> : null}
      </HStack>
    </AnalyticsLayout>
  );
}

/**
 * The page guard is the routes section's, not this module's.
 *
 * `platform/app` wrapped each of these in `withPermissionGuard("analytics:view")`
 * — and, on two of them, in `DashboardLayout` as well. Both are the composing
 * application's: the policy is stated once in
 * `apps/ui/src/features/analytics/ui/sections/analytics-routes.tsx`, in front of
 * the same loader registry, and the chrome belongs to the route tree these
 * screens are children of.
 */
export default ReportsContent;
