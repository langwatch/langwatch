import type { SpanTreeNode } from "@langwatch/trace-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useTraceQueryArgs } from "../../../behavior/explorer/use-trace-query-args.ts";
import { api } from "../../../behavior/trace-api.ts";
import { selectedSpanOwnerIn } from "../../../model/braids/braided-span.ts";
import { spanTreeQueryKey } from "./span-tree-paged-query.ts";

/**
 * Returns a callback that prefetches span detail for a given span id under the
 * currently-open trace. Wire it up to onMouseEnter/onFocus on span rows (waterfall,
 * span list, span tabs) so detail is already cached by the time the user clicks.
 */
export function usePrefetchSpanDetail() {
  // The arguments `useSpanDetail` reads with, member included, as primitives so the
  // callback keeps its identity across renders: span rows are memoised on it.
  const { isReady, projectId, traceId, tenantId, queryArgs } = useTraceQueryArgs();
  const { occurredAtMs } = queryArgs;
  const utils = api.useUtils();
  const queryClient = useQueryClient();

  return useCallback(
    (spanId: string) => {
      if (!isReady || !traceId || !spanId) return;
      const treeKey = spanTreeQueryKey({
        projectId,
        traceId,
        ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
        ...(tenantId !== null ? { tenantId } : {}),
      });
      const ownerProjectId = selectedSpanOwnerIn({
        nodes: queryClient.getQueryData<SpanTreeNode[]>(treeKey),
        spanId,
      });
      void utils.traces.spanDetail.prefetch({
        projectId,
        traceId,
        ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
        ...(tenantId !== null ? { tenantId } : {}),
        spanId,
        ...(ownerProjectId ? { ownerProjectId } : {}),
      });
    },
    [isReady, projectId, traceId, occurredAtMs, tenantId, utils, queryClient],
  );
}
