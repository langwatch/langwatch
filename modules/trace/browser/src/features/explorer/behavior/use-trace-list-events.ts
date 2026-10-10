import type { TraceEventRollup } from "@langwatch/trace-contract";
import { listedTraceKey } from "@langwatch/trace-contract";
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";

import { useFilterStore, useViewStore } from "../../../behavior/explorer.store.ts";
import type { TraceListItem } from "../../../behavior/explorer/types/trace.ts";
import { NO_TRACE_EVENTS } from "../../../behavior/explorer/types/trace.ts";
import { api } from "../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";

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
        .toSorted()
        .join(","),
    [rows],
  );
  const traceIds = useMemo(() => (traceIdsKey === "" ? [] : traceIdsKey.split(",")), [traceIdsKey]);

  const enabled = !!project?.id && !isSamplePreview && needsEvents && traceIds.length > 0;
  const query = api.traces.listEvents.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds,
      timeRange: { from: timeRange.from, to: timeRange.to },
    },
    {
      enabled,
      placeholderData: keepPreviousData,
    },
  );

  const rollups = query.data;
  // `keepPreviousData` hands back the previous page's rollups with `isLoading`
  // already false, so a row on the new page would find no entry of its own and
  // read as eventless. It is still waiting, and says so until its own answer
  // arrives.
  const isLoading = enabled && (query.isLoading || query.isPlaceholderData);
  const isUnavailable = enabled && query.isError;

  const projectId = project?.id;
  return useMemo(
    () =>
      mergeTraceEvents({
        rows,
        rollups,
        projectId,
        isLoading,
        isUnavailable,
      }),
    [rows, rollups, projectId, isLoading, isUnavailable],
  );
}

/**
 * Puts each row's rollup on the row; shared with the conversation view. Rollups are keyed by
 * project and trace id together (two aggregate members may share a trace id); a row is looked up
 * under the project it names, else the project that read it.
 */
export function mergeTraceEvents({
  rows,
  rollups,
  projectId,
  isLoading,
  isUnavailable,
}: {
  rows: TraceListItem[];
  rollups: Record<string, TraceEventRollup> | undefined;
  /** The project the read ran under, for a row that names no project. */
  projectId: string | undefined;
  isLoading: boolean;
  isUnavailable: boolean;
}): TraceListItem[] {
  if (!rollups && !isLoading && !isUnavailable) return rows;
  return rows.map((row) => {
    const owner = row.projectId ?? projectId;
    const rollup =
      owner === undefined
        ? undefined
        : rollups?.[listedTraceKey({ projectId: owner, traceId: row.traceId })];
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
