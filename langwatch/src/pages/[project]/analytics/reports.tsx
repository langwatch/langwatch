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
import { useRouter } from "next/router";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { useFilterToggle } from "~/components/filters/FilterToggle";
import GraphsLayout from "~/components/GraphsLayout";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import {
  calculateGridPositions,
  type GridLayout,
  ReportGrid,
  type SizeOption,
  sizeOptions,
} from "../../../components/analytics/reports";
import { Link } from "../../../components/ui/link";
import { withPermissionGuard } from "../../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

function ReportsContent() {
  const { project } = useOrganizationTeamProject();
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
  const updateLayout = api.graphs.updateLayout.useMutation();
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
              meta: { closable: true },
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
            meta: { closable: true },
          });
        },
      },
    );
  };

  const handleGraphSizeChange = (graphId: string, size: SizeOption) => {
    const sizeConfig = sizeOptions.find((s) => s.value === size);
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
        onError: () => {
          toaster.create({
            title: "Error updating graph size",
            type: "error",
            duration: 3000,
            meta: { closable: true },
          });
        },
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
        onError: () => {
          toaster.create({
            title: "Error reordering graphs",
            type: "error",
            duration: 3000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const graphs = graphsQuery.data ?? [];
  const hasNoGraphs = graphs.length === 0 && !graphsQuery.isLoading;

  // Build add chart URL with current dashboard
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
                You haven{"'"}t set up any custom graphs yet. Click + Add chart
                to get started.
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
              dashboardId={activeDashboardId ?? undefined}
              onGraphDelete={handleGraphDelete}
              onGraphSizeChange={handleGraphSizeChange}
              onGraphsReorder={handleGraphsReorder}
              deletingGraphId={
                deleteGraph.isLoading
                  ? (deleteGraph.variables?.id ?? null)
                  : null
              }
            />
          )}
        </Box>
        {showFilters ? <FilterSidebar /> : null}
      </HStack>
    </GraphsLayout>
  );
}

export default withPermissionGuard("analytics:view")(ReportsContent);
