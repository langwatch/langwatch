import type { PickableProject } from "../features/dashboard-widget/model/query-projects.ts";
import { analyticsApi } from "./analytics-api.ts";

/** The projects of the organization this member may name on a query; none while loading. */
export function useReadableProjects({ projectId }: { projectId: string }): PickableProject[] {
  const query = analyticsApi.analytics.lwql.readableProjects.useQuery(
    { projectId },
    { enabled: projectId.length > 0, retry: false },
  );

  return query.data?.projects ?? [];
}
