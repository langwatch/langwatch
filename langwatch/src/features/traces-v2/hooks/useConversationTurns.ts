import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { useTraceViewer } from "../context/TraceViewerContext";
import type { TraceListItem } from "../types/trace";

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
  const { readOnly, sharedThreadId } = useTraceViewer();
  const canReadSharedConversation =
    readOnly &&
    !!conversationId &&
    sharedThreadId != null &&
    conversationId === sharedThreadId;

  const timeRange = useMemo(
    () => conversationTurnsWindow(Date.now()),
    // Recompute only when the target conversation changes; the hour-rounded
    // window keeps the key stable across renders within the same hour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.id, conversationId],
  );

  const listQuery = api.tracesV2.list.useQuery(
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
      enabled: !!project?.id && !!conversationId && !readOnly,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );

  const sharedQuery = api.tracesV2.conversationContext.useQuery(
    {
      projectId: project?.id ?? "",
      conversationId: conversationId ?? "",
    },
    {
      enabled: !!project?.id && canReadSharedConversation,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );

  if (readOnly) {
    return {
      data:
        canReadSharedConversation && sharedQuery.data
          ? { items: sharedQuery.data.turns.map(toSharedConversationTurn) }
          : undefined,
      isLoading: canReadSharedConversation && sharedQuery.isLoading,
    };
  }

  return {
    data: listQuery.data ? { items: listQuery.data.items } : undefined,
    isLoading: listQuery.isLoading,
  };
}

type SharedConversationTurn =
  RouterOutputs["tracesV2"]["conversationContext"]["turns"][number];

/**
 * The public conversation endpoint intentionally returns only the fields the
 * read-only transcript needs. Fill the table-only fields with inert values so
 * the existing conversation renderer can be reused without exposing list-only
 * metadata such as cost, tokens, annotations, or arbitrary attributes.
 */
export function toSharedConversationTurn(
  turn: SharedConversationTurn,
): TraceListItem {
  return {
    traceId: turn.traceId,
    timestamp: turn.timestamp,
    name: turn.name,
    serviceName: "",
    durationMs: 0,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: turn.status,
    spanCount: 0,
    sizeBytes: 0,
    input: turn.input ?? null,
    output: turn.output ?? null,
    inputRedacted: turn.inputRedacted,
    outputRedacted: turn.outputRedacted,
    inputVisibleTo: turn.inputVisibleTo,
    outputVisibleTo: turn.outputVisibleTo,
    conversationId: undefined,
    origin: "application",
    rootSpanType: turn.rootSpanType ?? null,
    evaluations: [],
    events: [],
  };
}
