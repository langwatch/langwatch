import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { api } from "../../behavior/trace-api";
import type { ConversationGroup } from "../components/TraceTable/conversationGroups";
import {
  groupTracesByConversation,
  sortConversationGroups,
} from "../components/TraceTable/conversationGroups";
import { useSamplePreview } from "../onboarding";
import { useFilterStore, useViewStore } from "../../index";
import { mapSessionGroupsPayload } from "../utils/mapSessionGroupsPayload";

export interface SessionGroupsResult {
  groups: ConversationGroup[];
  totalHits: number;
  /** Opaque server cursor for the next page; null at the end. */
  nextCursor: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
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

/**
 * The `tracesV2.sessions` input for the current lens state. Sorts the server
 * does not understand are dropped rather than sent, so the read falls back to
 * its default order instead of erroring.
 */
function sessionsQueryInput(args: {
  projectId: string;
  timeRange: { from: number; to: number; label?: string | null };
  sort: { columnId: string; direction: "asc" | "desc" };
  page: number;
  pageSize: number;
  sessionCursor: string | undefined;
  queryText: string;
}) {
  const serverSort = SERVER_SORTABLE.has(args.sort.columnId)
    ? { columnId: args.sort.columnId, direction: args.sort.direction }
    : undefined;
  const cursor = args.page > 1 ? args.sessionCursor : undefined;
  return {
    projectId: args.projectId,
    timeRange: {
      from: args.timeRange.from,
      to: args.timeRange.to,
      live: !!args.timeRange.label,
    },
    ...(serverSort ? { sort: serverSort } : {}),
    pageSize: Math.min(args.pageSize, SESSIONS_MAX_PAGE_SIZE),
    ...(cursor ? { cursor } : {}),
    query: args.queryText || undefined,
  };
}

/** Fixture-backed groups: nothing is in flight, so every query flag is settled. */
const settledResult = (groups: ConversationGroup[]): SessionGroupsResult => ({
  groups,
  totalHits: groups.length,
  nextCursor: null,
  isLoading: false,
  isFetching: false,
  isPlaceholderData: false,
  isError: false,
  error: null,
});

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
 * Onboarding sample-preview groups, or null when no preview is active. The
 * fixture traces are grouped client-side, exactly like the lens used to work,
 * and they are one page by construction, so page-local grouping is honest
 * here in a way it never was for live data.
 */
function useSamplePreviewGroups(): ConversationGroup[] | null {
  const sort = useViewStore((s) => s.sort);
  const samplePreview = useSamplePreview();

  return useMemo<ConversationGroup[] | null>(() => {
    if (!samplePreview) return null;
    return sortConversationGroups({
      groups: groupTracesByConversation(samplePreview.data),
      sort,
    });
  }, [samplePreview, sort]);
}

/**
 * Data source of the Sessions lens (specs/traces-v2/sessions-lens.feature):
 * server-grouped session rollups over the WHOLE time range, so every total
 * on a row sums all of the session's traces, never just the fetched page.
 * The free-text query is forwarded too, server-side it also matches session
 * transcript content, so searching "#6418" finds the session that mentions
 * it even when no trace summary column carries the text.
 *
 * During onboarding sample preview the tRPC call is skipped and the fixtures
 * answer instead.
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
  const sampleGroups = useSamplePreviewGroups();

  const isActive = grouping === "by-conversation";
  // Only the sessions lens's own opaque cursors apply here, a structured
  // trace cursor left behind by the flat lens means the page number belongs
  // to a different pagination space, so snap back to page 1.
  const sessionCursor = typeof pageCursor === "string" ? pageCursor : undefined;
  useEffect(() => {
    if (isActive && page > 1 && sessionCursor === undefined) setPage(1);
  }, [isActive, page, sessionCursor, setPage]);

  const query = api.tracesV2.sessions.useQuery(
    sessionsQueryInput({
      projectId: project?.id ?? "",
      timeRange,
      sort,
      page,
      pageSize,
      sessionCursor,
      queryText,
    }),
    {
      enabled:
        isActive &&
        !!project?.id &&
        sampleGroups === null &&
        (page === 1 || sessionCursor !== undefined),
      staleTime: 60_000,
      placeholderData: keepPreviousData,
    },
  );

  const groups = useMemo<ConversationGroup[]>(
    () => mapSessionGroupsPayload(query.data),
    [query.data],
  );

  if (sampleGroups !== null) return settledResult(sampleGroups);

  return {
    groups,
    totalHits: query.data?.totalHits ?? 0,
    nextCursor: query.data?.nextCursor ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    isError: query.isError,
    error: query.error,
  };
}
