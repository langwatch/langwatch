import { useCallback } from "react";

import { useTraceQueryArgs } from "../../../behavior/explorer/use-trace-query-args.ts";
import { api } from "../../../behavior/trace-api.ts";

/**
 * Returns a callback that prefetches span detail for a given span id under the
 * currently-open trace. Wire it up to onMouseEnter/onFocus on span rows (waterfall,
 * span list, span tabs) so detail is already cached by the time the user clicks.
 */
export function usePrefetchSpanDetail() {
  // The arguments `useSpanDetail` reads with, member included, as primitives so the
  // callback keeps its identity across renders: span rows are memoised on it.
  const { isReady, projectId, traceId, occurredAtMs, tenantId } = useTraceQueryArgs();
  const utils = api.useUtils();

  return useCallback(
    (spanId: string) => {
      if (!isReady || !traceId || !spanId) return;
      void utils.traces.spanDetail.prefetch({
        projectId,
        traceId,
        ...(occurredAtMs !== null ? { occurredAtMs } : {}),
        ...(tenantId !== null ? { tenantId } : {}),
        spanId,
      });
    },
    [isReady, projectId, traceId, occurredAtMs, tenantId, utils],
  );
}
