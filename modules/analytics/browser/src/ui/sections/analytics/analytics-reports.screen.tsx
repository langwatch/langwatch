import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Banner } from "@langwatch/design-system/banner";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, HStack, Skeleton } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";

import { analyticsApi as api } from "../../../behavior/analytics-api.ts";
import { useShowErrorToast } from "../../../behavior/analytics-feedback.ts";
import {
  DashboardRefetchIntervalContext,
  useDashboardAutoRefresh,
} from "../../../behavior/use-dashboard-auto-refresh.ts";
import {
  useDashboardGraphs,
  useDashboards,
  useFirstDashboard,
} from "../../../behavior/use-dashboards.ts";
import { useFilterToggle } from "../../../behavior/use-filter-toggle.ts";
import { useWidgetGranularity } from "../../../features/dashboard-widget/behavior/use-widget-granularity.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import type { ChartGridPlacement } from "../../../model/chart-grid.ts";
import { Link } from "../../elements/analytics-link.tsx";
import { withAggregateAnalyticsGate } from "../aggregate-analytics-gate.tsx";
import AnalyticsLayout from "../analytics-layout.tsx";
import { DashboardAutoRefreshMenu } from "../dashboard-auto-refresh-menu.tsx";
import { FilterSidebar } from "../filter-sidebar.tsx";
import { ReportGrid } from "../report-grid.tsx";
import { DashboardRefreshedAtContext } from "../use-dashboard-auto-refresh.ts";

function ReportsContent() {
  const { project } = useOrganizationTeamProject();
  const host = useAnalyticsHost();
  // Each write is refused where the server refuses it: on an aggregate (ADR-177) and without
  // the grant. Grants come from the analytics host; the scope reading carries none.
  const canAddChart = host.hasPermission("analytics:create");
  const canRenameDashboard = host.hasPermission("analytics:update");
  const { showFilters } = useFilterToggle();
  const showErrorToast = useShowErrorToast();
  const projectId = project?.id ?? "";

  // Get dashboard ID from URL, or use first dashboard
  const urlDashboardId = host.route().query.dashboard;

  // Get or create first dashboard
  const getOrCreateFirst = useFirstDashboard({ projectId, enabled: !urlDashboardId });

  const activeDashboardId = urlDashboardId ?? getOrCreateFirst.data?.id;

  // Scheduled refresh: builder graphs poll on the chosen refetchInterval; workbench charts,
  // which run through a mutation, follow refreshedAt.
  const utils = api.useUtils();
  const autoRefresh = useDashboardAutoRefresh();

  // Fetch all dashboards to get current dashboard name
  const dashboardsQuery = useDashboards({ projectId });

  const currentDashboard = dashboardsQuery.data?.find((d) => d.id === activeDashboardId);
  const dashboardTitle = currentDashboard?.name ?? "Reports";
  // A link to a deleted or mistyped dashboard says so, rather than drawing an empty grid.
  const isMissingDashboard =
    !!urlDashboardId && dashboardsQuery.data !== undefined && !currentDashboard;

  // The charts made in Reports; a Dashboards widget is not shown here (AC199).
  const graphsQuery = useDashboardGraphs({ projectId, dashboardId: activeDashboardId });

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
          // Every graphs.getAll key, not just this dashboard's: the automation composer
          // reads the list keyed by {projectId} alone and kept offering a deleted graph.
          void utils.graphs.getAll.invalidate();
        },
        onError: (error) => {
          showErrorToast({ error, fallbackTitle: "Couldn't delete this graph" });
        },
      },
    );
  };

  const handleGraphsPlacementChange = (placements: ChartGridPlacement[]) => {
    if (placements.length === 0) return;
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
    return picked === undefined ? graph : { ...graph, granularitySeconds: picked };
  });
  const hasNoGraphs = graphs.length === 0 && !graphsQuery.isLoading;

  const addChartUrl = activeDashboardId
    ? `/${project?.slug}/analytics/custom?dashboard=${activeDashboardId}`
    : `/${project?.slug}/analytics/custom`;

  return (
    <AnalyticsLayout
      tab="reports"
      activeDashboardId={activeDashboardId}
      dashboard={{
        title: dashboardTitle,
        projectSlug: project?.slug ?? "",
        dashboardId: isMissingDashboard ? void 0 : (activeDashboardId ?? void 0),
        isEditable: canRenameDashboard,
        onTitleSave: handleTitleSave,
        actions: (
          <>
            <DashboardAutoRefreshMenu
              option={autoRefresh.option}
              onChange={autoRefresh.setOption}
            />
            {project && canAddChart ? <AddChartButton href={addChartUrl} /> : null}
          </>
        ),
      }}
    >
      {isMissingDashboard && (
        <Box marginBottom={6}>
          <Banner status="warning" title="This dashboard doesn't exist">
            It may have been deleted. Pick another dashboard from the menu.
          </Banner>
        </Box>
      )}

      {/* Empty state */}
      {hasNoGraphs && !isMissingDashboard && (
        <Box marginBottom={6}>
          <Banner
            status="info"
            title={canAddChart ? "Add your custom graphs here" : "No custom graphs yet"}
          >
            {canAddChart
              ? "You haven't set up any custom graphs yet. Click + Add chart to get started."
              : "Nobody has added a custom graph to this dashboard yet."}
          </Banner>
        </Box>
      )}

      {/* Main content */}
      <DashboardRefetchIntervalContext.Provider value={autoRefresh.refetchInterval}>
        <DashboardRefreshedAtContext.Provider value={autoRefresh.refreshedAt}>
          <HStack align="start" gap={6} width="full">
            <Box flex={1} minWidth={0}>
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
                    deleteGraph.isPending ? (deleteGraph.variables?.id ?? null) : null
                  }
                />
              )}
            </Box>
            {showFilters ? <FilterSidebar /> : null}
          </HStack>
        </DashboardRefreshedAtContext.Provider>
      </DashboardRefetchIntervalContext.Provider>
    </AnalyticsLayout>
  );
}

/**
 * The page guard is the routes section's, not this module's: stated once via
 * `withPermissionGuard("analytics:view")` in
 * `apps/ui/src/features/analytics/ui/sections/analytics-routes.tsx`.
 */
function AddChartButton({ href }: { href: string }) {
  return (
    <Link href={href} asChild>
      <PageLayout.HeaderButton primary data-testid="analytics-add-chart">
        <Plus /> Add chart
      </PageLayout.HeaderButton>
    </Link>
  );
}

/** Exported for the test that renders the body past the aggregate gate. */
export { ReportsContent };

export default withAggregateAnalyticsGate("Reports", ReportsContent);
