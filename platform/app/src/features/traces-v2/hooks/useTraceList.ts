import type { TraceListCursor } from "../stores/filterStore";
import type { TraceListItem } from "../types/trace";
import { useNewlyArrivedTraceIds } from "./useNewlyArrivedTraceIds";
import { useTraceListEvents } from "./useTraceListEvents";
import { useTraceListQuery } from "./useTraceListQuery";
import { useViewSwitchingDim } from "./useViewSwitchingDim";

export interface TraceListResult {
  data: TraceListItem[];
  totalHits: number;
  nextCursor: TraceListCursor | null;
  isLoading: boolean;
  isFetching: boolean;
  isPreviousData: boolean;
  isError: boolean;
  error: unknown;
  newIds: Set<string>;
}

/**
 * Trace list with side effects: pulse-highlight new arrivals + dim while
 * switching view, plus each row's events merged in from their own read. Use
 * `useTraceListQuery` directly when you only need the data and totals (no
 * side-effects, no events). Both hooks share the same React Query cache key,
 * so they're free to compose.
 */
export function useTraceList(): TraceListResult {
  const query = useTraceListQuery();
  const data = useTraceListEvents(query.data);
  const newIds = useNewlyArrivedTraceIds(query.data);
  useViewSwitchingDim({
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isPreviousData: query.isPreviousData,
  });

  return {
    data,
    totalHits: query.totalHits,
    nextCursor: query.nextCursor,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPreviousData: query.isPreviousData,
    isError: query.isError,
    error: query.error,
    newIds,
  };
}
