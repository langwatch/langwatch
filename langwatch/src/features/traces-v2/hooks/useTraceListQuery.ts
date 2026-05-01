import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useSamplePreview } from "../onboarding";
import { useFilterStore } from "../stores/filterStore";
import { useViewStore } from "../stores/viewStore";
import type { TraceEvalResult, TraceListItem } from "../types/trace";

export interface TraceListQueryResult {
  data: TraceListItem[];
  totalHits: number;
  isLoading: boolean;
  isFetching: boolean;
  isPreviousData: boolean;
  isFetched: boolean;
  isError: boolean;
  error: unknown;
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
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const sort = useViewStore((s) => s.sort);
  const samplePreview = useSamplePreview();

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
      query: queryText || undefined,
    },
    {
      enabled: !!project?.id && samplePreview === null,
      staleTime: 60_000,
      keepPreviousData: true,
    },
  );

  const data = useMemo<TraceListItem[]>(() => {
    if (!query.data) return [];
    const evalMap = (query.data.evaluations ?? {}) as Record<
      string,
      TraceEvalResult[]
    >;
    return (query.data.items as TraceListItem[]).map((item) => ({
      ...item,
      spanCount: item.spanCount ?? 0,
      evaluations: (evalMap[item.traceId] ?? []).map((e) => ({
        evaluatorId: e.evaluatorId,
        evaluatorName: e.evaluatorName,
        status: e.status,
        score: e.score,
        passed: e.passed,
        label: e.label,
      })),
      events: item.events ?? [],
    }));
  }, [query.data]);

  if (samplePreview) {
    return {
      data: samplePreview.data,
      totalHits: samplePreview.totalHits,
      isLoading: false,
      isFetching: false,
      isPreviousData: false,
      isFetched: true,
      isError: false,
      error: null,
    };
  }

  return {
    data,
    totalHits: query.data?.totalHits ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPreviousData: query.isPreviousData,
    isFetched: query.isFetched,
    isError: query.isError,
    error: query.error,
  };
}
