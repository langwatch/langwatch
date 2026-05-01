import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Query the trace list filtered down to one conversation, sorted oldest →
 * newest. The drawer's Conversation tab consumes the result as the turn
 * sequence for the active thread.
 *
 * Pinned to a per-(project, conversation) memoised time window so the query
 * key doesn't churn every render — otherwise React Query would refetch
 * forever and the UI would never settle.
 */
export function useConversationTurns(conversationId: string | null) {
  const { project } = useOrganizationTeamProject();

  // 90-day window: enough headroom for long-running conversations without
  // forcing ClickHouse to scan year-old (cold-tier) partitions on every
  // drawer open. `to` is rounded down to the current hour so re-opening the
  // same conversation within the hour reuses the cached query (raw
  // Date.now() makes every mount a fresh key and forces a refetch flash).
  const timeRange = useMemo(() => {
    const HOUR_MS = 60 * 60 * 1000;
    const to = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    return { from: to - 90 * 24 * HOUR_MS, to };
  }, [project?.id, conversationId]);

  return api.tracesV2.list.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange,
      sort: { columnId: "time", direction: "asc" },
      page: 1,
      pageSize: 100,
      query: conversationId
        ? `conversation:"${conversationId
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')}"`
        : "",
    },
    {
      enabled: !!project?.id && !!conversationId,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );
}
