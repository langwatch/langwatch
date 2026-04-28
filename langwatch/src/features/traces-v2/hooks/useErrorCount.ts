import { useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFreshnessSignal } from "../stores/freshnessSignal";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const FALLBACK_INTERVAL_MS = 60_000;

export function useErrorCount(): number {
  const { project } = useOrganizationTeamProject();

  // Fixed at mount time — the refetchInterval keeps data fresh without
  // changing the query key on every render.
  const [timeRange] = useState(() => {
    const now = Date.now();
    return { from: now - TWENTY_FOUR_HOURS_MS, to: now, live: true };
  });

  // SSE invalidates `tracesV2.newCount` (all args) on trace_summary_updated,
  // so this query is kept fresh without polling whenever SSE is healthy.
  const sseConnectionState = useFreshnessSignal((s) => s.sseConnectionState);
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
