import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useSamplePreview } from "../onboarding";
import type { TraceListCursor } from "../stores/filterStore";
import { useFilterStore } from "../stores/filterStore";
import { useViewStore } from "../stores/viewStore";
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
export function useTraceListQuery(): TraceListQueryResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const pageCursor = useFilterStore((s) => s.pageCursors[s.page]);
  const setPage = useFilterStore((s) => s.setPage);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const sort = useViewStore((s) => s.sort);
  const samplePreview = useSamplePreview();

  // Offset page numbers cannot be restored honestly after a reload because a
  // keyset cursor is intentionally opaque session state. Old `#?page=N` links
  // therefore fall back to the first batch instead of issuing an offset read.
  useEffect(() => {
    if (page > 1 && pageCursor === undefined) setPage(1);
  }, [page, pageCursor, setPage]);

  // Skip the tRPC request entirely while sample preview is active —
  // saves a roundtrip per page nav for users who're going to see
  // fixtures anyway.
  const query = api.tracesV2.list.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
      sort: { columnId: sort.columnId, direction: sort.direction },
      page,
      pageSize,
      ...(page > 1 && pageCursor ? { cursor: pageCursor } : {}),
      query: queryText || undefined,
    },
    {
      enabled:
        !!project?.id &&
        samplePreview === null &&
        (page === 1 || pageCursor !== undefined),
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
