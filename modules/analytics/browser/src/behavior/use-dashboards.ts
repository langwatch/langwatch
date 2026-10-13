import { analyticsApi } from "./analytics-api.ts";

/** The project's dashboards. */
export function useDashboards({ projectId }: { projectId: string }) {
  return analyticsApi.dashboards.getAll.useQuery({ projectId }, { enabled: !!projectId });
}

/** The project's first dashboard, created on demand. */
export function useFirstDashboard({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  return analyticsApi.dashboards.getOrCreateFirst.useQuery(
    { projectId },
    { enabled: !!projectId && enabled },
  );
}

/** The builder graphs placed on one dashboard. */
export function useDashboardGraphs({
  projectId,
  dashboardId,
}: {
  projectId: string;
  dashboardId: string | undefined;
}) {
  return analyticsApi.graphs.getAll.useQuery(
    { projectId, dashboardId },
    { enabled: !!projectId && !!dashboardId },
  );
}

/** The placed widgets of the project, across dashboards. */
export function useDashboardWidgets({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  return analyticsApi.dashboardWidgets.list.useQuery(
    { projectId },
    { enabled: !!projectId && enabled },
  );
}

/** One stored builder graph; a missing one is an error, not a retry. */
export function useStoredGraph({
  projectId,
  graphId,
  enabled,
}: {
  projectId: string;
  graphId: string | undefined;
  enabled: boolean;
}) {
  return analyticsApi.graphs.getById.useQuery(
    { projectId, id: graphId ?? "" },
    { enabled: enabled && !!projectId && !!graphId, retry: false },
  );
}

/** The project's evaluation monitors. */
export function useProjectMonitors({ projectId }: { projectId: string }) {
  return analyticsApi.monitors.getAllForProject.useQuery({ projectId }, { enabled: !!projectId });
}
