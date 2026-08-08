import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useIsReadOnlyTrace } from "../context/TraceViewerContext";
import type { TraceListItem } from "../types/trace";
import { mergeTraceEvents } from "./useTraceListEvents";

/** Padding on the read window, so an event stamped after its turn's start is still inside it. */
const WINDOW_PAD_MS = 60 * 60 * 1000;

/**
 * Attaches each conversation turn's events, read once per thread.
 *
 * Turns come from `tracesV2.list`, which stopped carrying events on the trace
 * summary, so the count on a turn separator has to be read back the same way
 * the trace table reads it. The table's own `useTraceListEvents` is bound to
 * the list's columns and filter time range; a thread has neither, so it reads
 * over the span the turns themselves cover.
 */
export function useConversationTurnEvents(
  turns: TraceListItem[],
): TraceListItem[] {
  const { project } = useOrganizationTeamProject();
  const isReadOnly = useIsReadOnlyTrace();

  // Deduplicated and sorted so two renders of the same thread ask for the same
  // ids in the same order, which is what lets them share a query key: the key
  // is compared structurally, not by identity.
  const traceIds = useMemo(
    () => [...new Set(turns.map((turn) => turn.traceId))].sort(),
    [turns],
  );

  const timeRange = useMemo(() => {
    if (turns.length === 0) return { from: 0, to: 0 };
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const turn of turns) {
      from = Math.min(from, turn.timestamp);
      to = Math.max(to, turn.timestamp + turn.durationMs);
    }
    return { from: from - WINDOW_PAD_MS, to: to + WINDOW_PAD_MS };
  }, [turns]);

  const enabled = !!project?.id && !isReadOnly && traceIds.length > 0;
  const query = api.tracesV2.listEvents.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds,
      timeRange,
    },
    {
      // Backed by the same project-protected read as the turns themselves, so
      // a share grant never opens it.
      enabled,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      keepPreviousData: true,
      trpc: { context: { skipBatch: true } },
    },
  );

  // `keepPreviousData` hands back the previous thread's rollups with
  // `isLoading` already false, so a turn of the new thread would find no entry
  // of its own and read as eventless while it is still waiting.
  const isLoading = enabled && (query.isLoading || query.isPreviousData);

  return useMemo(
    () =>
      mergeTraceEvents({
        rows: turns,
        rollups: query.data,
        isLoading,
        isUnavailable: enabled && query.isError,
      }),
    [turns, query.data, query.isError, isLoading, enabled],
  );
}
