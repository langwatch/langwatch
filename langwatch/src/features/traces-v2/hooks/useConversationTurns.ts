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

  const timeRange = useMemo(() => {
    const now = Date.now();
    return { from: now - 365 * 24 * 60 * 60 * 1000, to: now };
  }, [project?.id, conversationId]);

  return api.tracesV2.list.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange,
      sort: { columnId: "time", direction: "asc" },
      page: 1,
      pageSize: 100,
      query: conversationId
        ? `conversation:"${conversationId.replace(/"/g, '\\"')}"`
        : "",
    },
    {
      enabled: !!project?.id && !!conversationId,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );
}
