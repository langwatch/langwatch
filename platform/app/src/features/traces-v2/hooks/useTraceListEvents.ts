import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";
import { useViewStore } from "../stores/viewStore";
import type { TraceListItem } from "../types/trace";
import { NO_TRACE_EVENTS } from "../types/trace";

/**
 * Attaches each row's events, read once per visible page.
 *
 * Events are OTel span events on `stored_spans`; the trace-summary fold
 * deliberately stopped hoisting them (it grew the fold state O(span-count)),
 * so the list reads them back rather than finding them on the summary row.
 * That read is its own query: the list is what gates first paint, and a page
 * whose columns and grouping never mention events pays nothing.
 *
 * A failed read leaves the rest of the list standing rather than taking it
 * down: the column is supplementary to every other thing on the row. It says
 * so rather than falling back to the empty marker, which would report a trace
 * with events as having none.
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
  const traceIds = useMemo(
    () => (traceIdsKey === "" ? [] : traceIdsKey.split(",")),
    [traceIdsKey],
  );

  const enabled =
    !!project?.id && !isSamplePreview && needsEvents && traceIds.length > 0;
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

  return useMemo(() => {
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
  }, [rows, rollups, isLoading, isUnavailable]);
}

/**
 * Whether anything on screen reads a row's events: the Events column, or the
 * Conversations grouping, whose group rows total their turns' events.
 */
function rowsNeedEvents(state: {
  columnOrder: string[];
  grouping: string;
}): boolean {
  return (
    state.columnOrder.includes("events") || state.grouping === "by-conversation"
  );
}
