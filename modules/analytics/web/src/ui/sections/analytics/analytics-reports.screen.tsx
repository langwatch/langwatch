import {
  Alert,
  Box,
  Button,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { DashboardAutoRefreshMenu } from "../DashboardAutoRefreshMenu.tsx";
import {
  DashboardRefreshedAtContext,
  useDashboardAutoRefresh,
} from "../useDashboardAutoRefresh.ts";
import { FilterSidebar } from "../filter-sidebar.tsx";
import { useFilterToggle } from "../../../behavior/use-filter-toggle.ts";
import AnalyticsLayout from "../analytics-layout.tsx";
import { useShowErrorToast } from "../../../behavior/analytics-feedback.ts";
import { useWidgetGranularity } from "../../../behavior/use-widget-granularity.ts";
import { useFeatureFlag } from "@langwatch/workflow-web/surfaces/feature-flag";
import { analyticsApi as api } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { ReportGrid } from "../report-grid.tsx";
import { Link } from "../../elements/analytics-link.tsx";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { CreateDashboardWidgetDrawer } from "../CreateDashboardWidgetDrawer.tsx";
import type { ChartGridPlacement } from "../../../model/chartGrid.ts";

function ReportsContent() {
  const { project, organization } = useOrganizationTeamProject();
  const { showFilters } = useFilterToggle();
  const host = useAnalyticsHost();
  const showErrorToast = useShowErrorToast();
  const projectId = project?.id ?? "";

  // Get dashboard ID from URL, or use first dashboard
  const urlDashboardId = host.route().query.dashboard;

  // Get or create first dashboard
  const getOrCreateFirst = api.dashboards.getOrCreateFirst.useQuery(
    { projectId },
    { enabled: !!projectId && !urlDashboardId },
  );

  const activeDashboardId = urlDashboardId ?? getOrCreateFirst.data?.id;

  const [isAddChartOpen, setIsAddChartOpen] = useState(false);

  // Gates the new dashboard-widget "Add chart" flow client-side to match the
  // server-side enforcement in the dashboardWidgets tRPC router
  // (enforceCustomChartPlaygroundEnabled) — without this, a user with the
  // flag off would get a drawer whose Save always fails. `enabled` defaults
  // to false while the query is loading, so the button starts as the legacy
  // link and (for flagged-in accounts) swaps to the drawer once resolved,
  // rather than flashing the drawer open state first.
  const { enabled: customChartPlaygroundEnabled } = useFeatureFlag(
    "release_custom_chart_playground",
    {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: !!project?.id && !!organization?.id,
    },
  );

  // Scheduled refresh: widgets follow refreshedAt through their dashboard
  // context; builder graphs and placed charts re-fetch through tRPC.
  const utils = api.useUtils();
  const autoRefresh = useDashboardAutoRefresh({
    onTick: () => {
      void utils.analytics.invalidate();
    },
  });

  // Fetch all dashboards to get current dashboard name
  const dashboardsQuery = api.dashboards.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const currentDashboard = dashboardsQuery.data?.find(
    (d) => d.id === activeDashboardId,
  );
  const dashboardTitle = currentDashboard?.name ?? "Reports";

  // Graphs for the active dashboard
  const graphsQuery = api.graphs.getAll.useQuery(
    { projectId, dashboardId: activeDashboardId },
    { enabled: !!projectId && !!activeDashboardId },
  );

  const deleteGraph = api.graphs.delete.useMutation();
  const batchUpdateLayouts = api.graphs.batchUpdateLayouts.useMutation();
  const renameDashboard = api.dashboards.rename.useMutation();

  const handleTitleSave = (newTitle: string) => {
    if (activeDashboardId) {
      renameDashboard.mutate(
        { projectId, dashboardId: activeDashboardId, name: newTitle },
        {
          onSuccess: () => {
            void dashboardsQuery.refetch();
          },
          onError: (error) => {
            showErrorToast({ error, fallbackTitle: "Couldn't rename this dashboard" });
          },
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
        onError: (error) => {
          showErrorToast({ error, fallbackTitle: "Couldn't delete this graph" });
        },
      },
    );
  };

  const handleGraphsPlacementChange = (placements: ChartGridPlacement[]) => {
    batchUpdateLayouts.mutate(
      { projectId, layouts: placements },
      {
        onSuccess: () => {
          void graphsQuery.refetch();
        },
        onError: (error) => {
          showErrorToast({ error, fallbackTitle: "Couldn't save the dashboard layout" });
        },
      },
    );
  };

  // Datapoint step per workbench widget, keyed by chart id, held in URL state.
  // Not a stored column (no migration owns `granularitySeconds` yet); not
  // component state either, since that would drop on reload and be missing
  // from a shared link — a coarsened card would show a colleague a different chart.
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
    return picked === undefined
      ? graph
      : { ...graph, granularitySeconds: picked };
  });
  const hasNoGraphs = graphs.length === 0 && !graphsQuery.isLoading;

  // Legacy builder route — used when the playground flag is off (or still
  // loading), matching main's Add-chart handler.
  const addChartUrl = activeDashboardId
    ? `/${project?.slug}/analytics/custom?dashboard=${activeDashboardId}`
    : `/${project?.slug}/analytics/custom`;

  return (
    <AnalyticsLayout
      title={dashboardTitle}
      railEntry="reports"
      analyticsHeaderProps={{
        isEditable: true,
        onTitleSave: handleTitleSave,
      }}
      extraHeaderButtons={
        <>
          <DashboardAutoRefreshMenu
            option={autoRefresh.option}
            onChange={autoRefresh.setOption}
          />
          {project ? (
            customChartPlaygroundEnabled ? (
              <Button
                colorPalette="orange"
                size="sm"
                onClick={() => setIsAddChartOpen(true)}
              >
                <Plus /> Add chart
              </Button>
            ) : (
              <Link href={addChartUrl} asChild>
                <Button colorPalette="orange" size="sm">
                  <Plus /> Add chart
                </Button>
              </Link>
            )
          ) : null}
        </>
      }
    >
      {/* The workbench builder's own save path is disabled while the
          custom-chart-playground is enabled (see DashboardWidgetService /
          saved_workbench_charts_disabled_for_playground) — a member landing
          there would hit a Save button that always fails. This drawer is
          the one "create a new chart" path that still works, and it lands
          the new widget on this dashboard directly. */}
      {project && customChartPlaygroundEnabled && (
        <CreateDashboardWidgetDrawer
          open={isAddChartOpen}
          onClose={() => setIsAddChartOpen(false)}
          projectId={projectId}
          projectSlug={project.slug}
          dashboardId={activeDashboardId ?? undefined}
        />
      )}

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
                You haven{"'"}t set up any custom graphs yet. Click + Add chart
                to get started.
              </Text>
            </Alert.Description>
          </VStack>
        </Alert.Root>
      )}

      {/* Main content */}
      <DashboardRefreshedAtContext.Provider value={autoRefresh.refreshedAt}>
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
                onGraphGranularityChange={handleGraphGranularityChange}
                onGraphsPlacementChange={handleGraphsPlacementChange}
                deletingGraphId={
                  deleteGraph.isPending
                    ? (deleteGraph.variables?.id ?? null)
                    : null
                }
              />
            )}
          </Box>
          {showFilters ? <FilterSidebar /> : null}
        </HStack>
      </DashboardRefreshedAtContext.Provider>
    </AnalyticsLayout>
  );
}

/**
 * The page guard is the routes section's, not this module's: stated once via
 * `withPermissionGuard("analytics:view")` in
 * `apps/ui/src/features/analytics/ui/sections/analytics-routes.tsx`.
 */
export default ReportsContent;
