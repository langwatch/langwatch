import { useEffect, useMemo } from "react";
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
  isPreviousData: boolean;
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
  const setPage = useFilterStore((s) => s.setPage);
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
  const traceCursor =
    pageCursor && typeof pageCursor === "object" ? pageCursor : undefined;
  const effectivePage = ownsPagination ? page : 1;

  // Offset page numbers cannot be restored honestly after a reload because a
  // keyset cursor is intentionally opaque session state. Old `#?page=N` links
  // therefore fall back to the first batch instead of issuing an offset read.
  // A string cursor left behind by the sessions lens is equally unusable here.
  useEffect(() => {
    if (ownsPagination && page > 1 && traceCursor === undefined) setPage(1);
  }, [ownsPagination, page, traceCursor, setPage]);

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
      enabled:
        !!project?.id &&
        samplePreview === null &&
        (effectivePage === 1 || traceCursor !== undefined),
      staleTime: 60_000,
      keepPreviousData: true,
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
      isPreviousData: false,
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
    isPreviousData: query.isPreviousData,
    isFetched: query.isFetched,
    isError: query.isError,
    error: query.error,
    isSamplePreview: false,
  };
}
