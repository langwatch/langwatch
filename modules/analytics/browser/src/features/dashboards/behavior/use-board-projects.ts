/**
 * The projects an Organization board opens under for this member, and the move to one of
 * them: the same board, at the same address, under the other project.
 * @see modules/dashboard/specs/dashboards-v2.feature AC182
 */

import type { DashboardProject, DashboardScope } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardsPath } from "../model/boards.ts";

export function useBoardProjects({ board }: { board: { id: string; scope: DashboardScope } }) {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const isShared = board.scope === "ORGANIZATION";

  const list = analyticsApi.dashboards.scopeProjects.useQuery(
    { projectId, dashboardId: board.id },
    { enabled: !!projectId && isShared },
  );

  return {
    /** Only an Organization board says whose data it shows. */
    isShared,
    current: { id: projectId, name: project?.name ?? "" },
    ownerProject: list.data?.ownerProject,
    projects: list.data?.projects ?? [],
    openIn: ({ slug }: DashboardProject) =>
      host.navigate(dashboardsPath({ projectSlug: slug, dashboardId: board.id })),
  };
}
