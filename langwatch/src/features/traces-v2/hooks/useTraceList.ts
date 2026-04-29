import type { TraceListItem } from "../types/trace";
import { useNewlyArrivedTraceIds } from "./useNewlyArrivedTraceIds";
import { useTraceListQuery } from "./useTraceListQuery";
import { useViewSwitchingDim } from "./useViewSwitchingDim";

export interface TraceListResult {
  data: TraceListItem[];
  totalHits: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  newIds: Set<string>;
}

/**
 * Trace list with side effects: pulse-highlight new arrivals + dim while
 * switching view. Use `useTraceListQuery` directly when you only need the
 * data and totals (no side-effects). Both hooks share the same React Query
 * cache key, so they're free to compose.
 */
export function useTraceList(): TraceListResult {
  const query = useTraceListQuery();
  const newIds = useNewlyArrivedTraceIds(query.data);
  useViewSwitchingDim({
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isPreviousData: query.isPreviousData,
  });

  return {
    data: query.data,
    totalHits: query.totalHits,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    newIds,
  };
}
