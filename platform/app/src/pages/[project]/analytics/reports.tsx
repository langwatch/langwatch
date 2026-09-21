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
import { DashboardAutoRefreshMenu } from "~/components/analytics/DashboardAutoRefreshMenu";
import {
  DashboardRefreshedAtContext,
  useDashboardAutoRefresh,
} from "~/components/analytics/useDashboardAutoRefresh";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { useFilterToggle } from "~/components/filters/FilterToggle";
import GraphsLayout from "~/components/GraphsLayout";
import { toaster } from "~/components/ui/toaster";
import { useWidgetGranularity } from "~/features/analytics-query/hooks/useWidgetGranularity";
import { CreateDashboardWidgetDrawer } from "~/features/custom-chart-playground/CreateDashboardWidgetDrawer";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import type { ChartGridPlacement } from "~/server/analytics/chartGrid";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { ReportGrid } from "../../../components/analytics/reports";
import { Link } from "../../../components/ui/link";
import { withPermissionGuard } from "../../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

function ReportsContent() {
  const { project, organization } = useOrganizationTeamProject();
  const { showFilters } = useFilterToggle();
  const router = useRouter();
  const projectId = project?.id ?? "";

  // Get dashboard ID from URL, or use first dashboard
  const urlDashboardId = router.query.dashboard as string | undefined;

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
          onError: () => {
            toaster.create({
              title: "Error renaming dashboard",
              type: "error",
              duration: 3000,
            });
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
        onError: () => {
          toaster.create({
            title: "Error deleting graph",
            type: "error",
            duration: 3000,
          });
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
        onError: () => {
          toaster.create({
            title: "Error saving the dashboard layout",
            type: "error",
            duration: 3000,
          });
        },
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
    <GraphsLayout
      title={dashboardTitle}
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
    </GraphsLayout>
  );
}

export default withPermissionGuard("analytics:view")(ReportsContent);
