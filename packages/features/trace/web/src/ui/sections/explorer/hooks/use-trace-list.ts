import type { TraceListCursor } from "../../../../index";
import type { TraceListItem } from "../types/trace";
import { useNewlyArrivedTraceIds } from "./use-newly-arrived-trace-ids";
import { useTraceListAnnotations } from "./use-trace-list-annotations";
import { useTraceListEvents } from "./use-trace-list-events";
import { useTraceListQuery } from "./use-trace-list-query";
import { useViewSwitchingDim } from "./use-view-switching-dim";

export interface TraceListResult {
  data: TraceListItem[];
  totalHits: number;
  nextCursor: TraceListCursor | null;
  isLoading: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isError: boolean;
  error: unknown;
  newIds: Set<string>;
}

/**
 * Trace list with side effects: pulse-highlight new arrivals + dim while
 * switching view, plus each row's events and annotations merged in from their
 * own reads. Use `useTraceListQuery` directly when you only need the data and
 * totals (no side-effects, no events, no annotations). Both hooks share the
 * same React Query cache key, so they're free to compose.
 */
export function useTraceList(): TraceListResult {
  const query = useTraceListQuery();
  const withEvents = useTraceListEvents({
    rows: query.data,
    isSamplePreview: query.isSamplePreview,
  });
  const data = useTraceListAnnotations({
    rows: withEvents,
    isSamplePreview: query.isSamplePreview,
  });
  const newIds = useNewlyArrivedTraceIds(query.data);
  useViewSwitchingDim({
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isPlaceholderData: query.isPlaceholderData,
  });

  return {
    data,
    totalHits: query.totalHits,
    nextCursor: query.nextCursor,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    isError: query.isError,
    error: query.error,
    newIds,
  };
}
