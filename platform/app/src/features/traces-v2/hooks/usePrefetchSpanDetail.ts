import { useCallback } from "react";
import { api } from "~/utils/api";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/**
 * Returns a callback that prefetches span detail for a given span id under
 * the currently-open trace. Wire it up to onMouseEnter/onFocus on span rows
 * (waterfall, span list, span tabs) so detail is already cached by the time
 * the user clicks.
 */
export function usePrefetchSpanDetail() {
  // The same arguments `useSpanDetail` reads with, so the prefetch lands in
  // the cache entry the click reads, the member included on an aggregate.
  // Taken apart into primitives so the callback keeps its identity across
  // renders: span rows are memoised on it.
  const { isReady, projectId, traceId, occurredAtMs, tenantId } =
    useTraceQueryArgs();
  const utils = api.useUtils();

  return useCallback(
    (spanId: string) => {
      if (!isReady || !traceId || !spanId) return;
      void utils.tracesV2.spanDetail.prefetch(
        {
          projectId,
          traceId,
          ...(occurredAtMs !== null ? { occurredAtMs } : {}),
          ...(tenantId !== null ? { tenantId } : {}),
          spanId,
        },
        { staleTime: 300_000 },
      );
    },
    [isReady, projectId, traceId, occurredAtMs, tenantId, utils],
  );
}
