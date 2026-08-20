import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useSamplePreview } from "../onboarding";
import type { TraceListCursor } from "../stores/filterStore";
import { useFilterStore } from "../stores/filterStore";
import { DEFAULT_SORT, useViewStore } from "../stores/viewStore";
import type { TraceListItem } from "../types/trace";
import { mapTraceListPayload } from "../utils/mapTraceListPayload";

export interface TraceListQueryResult {
  data: TraceListItem[];
  totalHits: number;
  nextCursor: TraceListCursor | null;
  isLoading: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isFetched: boolean;
  isError: boolean;
  error: unknown;
  /**
   * Whether the rows are onboarding fixtures rather than the project's own
   * traces. Their ids exist nowhere but the fixture file, so anything that
   * would enrich a row from the backend has to sit the preview out.
   */
  isSamplePreview: boolean;
}

/**
 * Pure tRPC + mapping layer. The lens's saved filter is encoded into
 * `filterStore.queryText` when the lens is selected, so this hook only
 * has to forward queryText, sort, page, and time range — no per-lens
 * special-casing.
 *
 * Onboarding sample-data injection is delegated to `useSamplePreview`
 * from the onboarding module's public API. When the journey is active
 * that hook returns a fixture set; when it's not, this hook just runs
 * the real tRPC query like normal. We don't import any other onboarding
 * internals — `useSamplePreview` is the entire integration seam.
 */
/** The `tracesV2.list` input for the current filter, sort and page state. */
function traceListQueryInput({
  projectId,
  timeRange,
  sort,
  page,
  pageSize,
  traceCursor,
  queryText,
}: {
  projectId: string;
  timeRange: { from: number; to: number; label?: string | null };
  sort: { columnId: string; direction: "asc" | "desc" };
  page: number;
  pageSize: number;
  traceCursor: TraceListCursor | undefined;
  queryText: string;
}) {
  const cursor = page > 1 ? traceCursor : undefined;
  return {
    projectId,
    timeRange: {
      from: timeRange.from,
      to: timeRange.to,
      live: !!timeRange.label,
    },
    sort: { columnId: sort.columnId, direction: sort.direction },
    page,
    pageSize,
    ...(cursor ? { cursor } : {}),
    query: queryText || undefined,
  };
}

export function useTraceListQuery(): TraceListQueryResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const pageCursor = useFilterStore((s) => s.pageCursors[s.page]);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const sort = useViewStore((s) => s.sort);
  const grouping = useViewStore((s) => s.grouping);
  const samplePreview = useSamplePreview();

  // The sessions lens paginates with its own opaque string cursors through
  // the SAME shared page number (see useSessionGroups). While it is active,
  // this hook pins itself to the first batch and leaves the page state
  // alone, otherwise the two hooks would fight over `page`, each resetting
  // the other's cursor space.
  const ownsPagination = grouping !== "by-conversation";
  // The sessions lens sorts by dimensions only a session has (`lastTurn`,
  // `turns`), and forwarding one of those here would ask the flat list to
  // order by a column it does not have. It still runs while that lens is
  // active because FindBar reads its rows, so it asks for its own default
  // order rather than the session's.
  const listSort = ownsPagination ? sort : DEFAULT_SORT;
  // `tracesV2.list` reads by position when no cursor comes with the page, so a
  // page nobody has walked to (a jump straight to page 12, a reloaded
  // `#?page=N` link, or a page number the sessions lens left behind with a
  // string cursor this lens cannot read) is answered by offset rather than
  // snapped back to the first batch.
  const traceCursor =
    pageCursor && typeof pageCursor === "object" ? pageCursor : undefined;
  const effectivePage = ownsPagination ? page : 1;

  // Skip the tRPC request entirely while sample preview is active —
  // saves a roundtrip per page nav for users who're going to see
  // fixtures anyway.
  const query = api.tracesV2.list.useQuery(
    traceListQueryInput({
      projectId: project?.id ?? "",
      timeRange,
      sort: listSort,
      page: effectivePage,
      pageSize,
      traceCursor,
      queryText,
    }),
    {
      enabled: !!project?.id && samplePreview === null,
      staleTime: 60_000,
      placeholderData: keepPreviousData,
    },
  );

  const data = useMemo<TraceListItem[]>(
    () => mapTraceListPayload(query.data),
    [query.data],
  );

  if (samplePreview) {
    return {
      data: samplePreview.data,
      totalHits: samplePreview.totalHits,
      nextCursor: null,
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isFetched: true,
      isError: false,
      error: null,
      isSamplePreview: true,
    };
  }

  return {
    data,
    totalHits: query.data?.totalHits ?? 0,
    nextCursor: query.data?.nextCursor ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    isFetched: query.isFetched,
    isError: query.isError,
    error: query.error,
    isSamplePreview: false,
  };
}
