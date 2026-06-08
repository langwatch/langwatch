import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_DAYS = 90;

/**
 * Time window for the conversation-turns query.
 *
 * A 90-day span gives long-running conversations enough headroom without
 * forcing ClickHouse to scan year-old (cold-tier) partitions on every drawer
 * open. The upper bound is rounded *up* to the next hour: that keeps the
 * computed window (and therefore the query key) identical for every open
 * within the same hour, so re-opening a conversation reuses the cached query
 * instead of flashing a refetch — while still covering turns recorded earlier
 * in the current hour. Rounding *down* would place the upper bound before
 * those turns' `OccurredAt`, silently dropping the most recent turns from the
 * thread (the Conversation tab then shows "No turns found" even though the
 * pager, which queries up to `now`, sees them).
 */
export function conversationTurnsWindow(nowMs: number): {
  from: number;
  to: number;
} {
  const to = Math.ceil(nowMs / HOUR_MS) * HOUR_MS;
  return { from: to - WINDOW_DAYS * 24 * HOUR_MS, to };
}

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

  const timeRange = useMemo(
    () => conversationTurnsWindow(Date.now()),
    // Recompute only when the target conversation changes; the hour-rounded
    // window keeps the key stable across renders within the same hour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.id, conversationId],
  );

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
