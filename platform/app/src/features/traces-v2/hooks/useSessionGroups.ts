import { useEffect, useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { ConversationGroup } from "../components/TraceTable/conversationGroups";
import {
  groupTracesByConversation,
  sortConversationGroups,
} from "../components/TraceTable/conversationGroups";
import { useSamplePreview } from "../onboarding";
import { useFilterStore } from "../stores/filterStore";
import { useViewStore } from "../stores/viewStore";
import { mapSessionGroupsPayload } from "../utils/mapSessionGroupsPayload";

export interface SessionGroupsResult {
  groups: ConversationGroup[];
  totalHits: number;
  /** Opaque server cursor for the next page; null at the end. */
  nextCursor: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isPreviousData: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * Server page ceiling of `tracesV2.sessions`, mirrored by the pagination
 * chrome while this lens is active so the range copy and the offered page
 * sizes never claim more rows than a page can hold. Sessions pages stay
 * small on purpose: every row costs a per-session coding-agent enrichment
 * lookup, so the read is priced for browsing, not export.
 */
export const SESSIONS_MAX_PAGE_SIZE = 100;

/** Sort dimensions `tracesV2.sessions` understands (see SessionGroupsService). */
const SERVER_SORTABLE = new Set([
  "started",
  "lastTurn",
  "duration",
  "cost",
  "tokens",
  "turns",
]);

/**
 * Data source of the Sessions lens (specs/traces-v2/sessions-lens.feature):
 * server-grouped session rollups over the WHOLE time range, so every total
 * on a row sums all of the session's traces, never just the fetched page.
 * The free-text query is forwarded too, server-side it also matches session
 * transcript content, so searching "#6418" finds the session that mentions
 * it even when no trace summary column carries the text.
 *
 * During onboarding sample preview the tRPC call is skipped and the fixture
 * traces are grouped client-side, exactly like the lens used to work, the
 * fixtures are one page by construction, so page-local grouping is honest
 * there.
 */
export function useSessionGroups(): SessionGroupsResult {
  const { project } = useOrganizationTeamProject();
  const grouping = useViewStore((s) => s.grouping);
  const sort = useViewStore((s) => s.sort);
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const pageCursor = useFilterStore((s) => s.pageCursors[s.page]);
  const setPage = useFilterStore((s) => s.setPage);
  const samplePreview = useSamplePreview();

  const isActive = grouping === "by-conversation";
  // Only the sessions lens's own opaque cursors apply here, a structured
  // trace cursor left behind by the flat lens means the page number belongs
  // to a different pagination space, so snap back to page 1.
  const sessionCursor = typeof pageCursor === "string" ? pageCursor : undefined;
  useEffect(() => {
    if (isActive && page > 1 && sessionCursor === undefined) setPage(1);
  }, [isActive, page, sessionCursor, setPage]);

  const serverSort = SERVER_SORTABLE.has(sort.columnId)
    ? { columnId: sort.columnId, direction: sort.direction }
    : undefined;

  const query = api.tracesV2.sessions.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
      ...(serverSort ? { sort: serverSort } : {}),
      pageSize: Math.min(pageSize, SESSIONS_MAX_PAGE_SIZE),
      ...(page > 1 && sessionCursor ? { cursor: sessionCursor } : {}),
      query: queryText || undefined,
    },
    {
      enabled:
        isActive &&
        !!project?.id &&
        samplePreview === null &&
        (page === 1 || sessionCursor !== undefined),
      staleTime: 60_000,
      keepPreviousData: true,
    },
  );

  const groups = useMemo<ConversationGroup[]>(
    () => mapSessionGroupsPayload(query.data),
    [query.data],
  );

  const sampleGroups = useMemo<ConversationGroup[]>(() => {
    if (!samplePreview) return [];
    return sortConversationGroups({
      groups: groupTracesByConversation(samplePreview.data),
      sort,
    });
  }, [samplePreview, sort]);

  if (samplePreview) {
    return {
      groups: sampleGroups,
      totalHits: sampleGroups.length,
      nextCursor: null,
      isLoading: false,
      isFetching: false,
      isPreviousData: false,
      isError: false,
      error: null,
    };
  }

  return {
    groups,
    totalHits: query.data?.totalHits ?? 0,
    nextCursor: query.data?.nextCursor ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPreviousData: query.isPreviousData,
    isError: query.isError,
    error: query.error,
  };
}
