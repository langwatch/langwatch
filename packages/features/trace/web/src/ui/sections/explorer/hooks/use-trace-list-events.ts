import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import type { TraceEventRollup } from "@langwatch/trace-contract";
import { api } from "../../trace-api";
import { useFilterStore, useViewStore } from "../../../../index";
import type { TraceListItem } from "../types/trace";
import { NO_TRACE_EVENTS } from "../types/trace";

/**
 * Attaches each row's events, read once per visible page.
 */
export function useTraceListEvents({
  rows,
  isSamplePreview = false,
}: {
  rows: TraceListItem[];
  /** Fixture rows carry their own events and have no ids to read back. */
  isSamplePreview?: boolean;
}): TraceListItem[] {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const needsEvents = useViewStore(rowsNeedEvents);

  // Sorted so two renders of the same page share a query key regardless of
  // the sort column, and joined because the key is compared structurally.
  const traceIdsKey = useMemo(
    () =>
      rows
        .map((row) => row.traceId)
        .sort()
        .join(","),
    [rows],
  );
  const traceIds = useMemo(() => (traceIdsKey === "" ? [] : traceIdsKey.split(",")), [traceIdsKey]);

  const enabled = !!project?.id && !isSamplePreview && needsEvents && traceIds.length > 0;
  const query = api.tracesV2.listEvents.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds,
      timeRange: { from: timeRange.from, to: timeRange.to },
    },
    {
      enabled,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
      trpc: { context: { skipBatch: true } },
    },
  );

  const rollups = query.data;
  // `keepPreviousData` hands back the previous page's rollups with `isLoading`
  // already false, so a row on the new page would find no entry of its own and
  // read as eventless. It is still waiting, and says so until its own answer
  // arrives.
  const isLoading = enabled && (query.isLoading || query.isPlaceholderData);
  const isUnavailable = enabled && query.isError;

  return useMemo(
    () => mergeTraceEvents({ rows, rollups, isLoading, isUnavailable }),
    [rows, rollups, isLoading, isUnavailable],
  );
}

/**
 * Puts each row's rollup on the row. Shared with the conversation view, whose
 * turns are trace rows read outside the list and need the same merge.
 */
export function mergeTraceEvents({
  rows,
  rollups,
  isLoading,
  isUnavailable,
}: {
  rows: TraceListItem[];
  rollups: Record<string, TraceEventRollup> | undefined;
  isLoading: boolean;
  isUnavailable: boolean;
}): TraceListItem[] {
  if (!rollups && !isLoading && !isUnavailable) return rows;
  return rows.map((row) => {
    const rollup = rollups?.[row.traceId];
    return {
      ...row,
      events: rollup
        ? {
            groups: rollup.names,
            totalCount: rollup.totalCount,
            distinctCount: rollup.distinctCount,
          }
        : NO_TRACE_EVENTS,
      eventsLoading: isLoading,
      eventsUnavailable: isUnavailable,
    };
  });
}

/**
 * Whether anything on screen reads a row's events: the Events column, or the
 * Conversations grouping, whose group rows total their turns' events.
 */
function rowsNeedEvents(state: { columnOrder: string[]; grouping: string }): boolean {
  return state.columnOrder.includes("events") || state.grouping === "by-conversation";
}
