import { useFilterStore } from "../../../../behavior/explorer.store.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";

export function useErrorCount(): number {
  const { project } = useOrganizationTeamProject();

  // Bind to the user's currently-selected time range so the Errors lens tab badge
  // reports the same window as every other panel on the page.
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);

  // SSE invalidates `traces.newCount` (all args) on trace_summary_updated.
  const query = api.traces.newCount.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange,
      since: timeRange.from,
      query: "status:error",
    },
    {
      enabled: !!project?.id,
    },
  );

  return query.data?.count ?? 0;
}
