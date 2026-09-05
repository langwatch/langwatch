import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { api } from "../../../../behavior/trace-api";
import { useFilterStore, useSseStatusStore } from "../../../../index";

const FALLBACK_INTERVAL_MS = 60_000;

export function useErrorCount(): number {
  const { project } = useOrganizationTeamProject();

  // Bind to the user's currently-selected time range so the Errors lens tab badge
  // reports the same window as every other panel on the page.
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);

  // SSE invalidates `tracesV2.newCount` (all args) on trace_summary_updated,
  // so this query is kept fresh without polling whenever SSE is healthy.
  const sseConnectionState = useSseStatusStore((s) => s.sseConnectionState);
  const sseConnected = sseConnectionState === "connected";

  const query = api.tracesV2.newCount.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange,
      since: timeRange.from,
      query: "status:error",
    },
    {
      enabled: !!project?.id,
      staleTime: 30_000,
      refetchInterval: sseConnected ? false : FALLBACK_INTERVAL_MS,
    },
  );

  return query.data?.count ?? 0;
}
