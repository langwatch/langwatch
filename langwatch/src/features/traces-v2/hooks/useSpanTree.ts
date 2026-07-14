import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import { LIVE_REFETCH_MS } from "../constants/freshness";
import { useSseStatusStore } from "../stores/sseStatusStore";
import {
  mergeSpanTreeDelta,
  spanTreeDeltaSinceMs,
  spanTreeQueryFn,
  spanTreeQueryKey,
} from "./spanTreePagedQuery";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

export function useSpanTree() {
  const { isLive, isReady, queryArgs } = useTraceQueryArgs();
  // `useTraceFreshness` invalidates `tracesV2.spanTree` on every
  // `trace_updated` SSE event for the open trace — when SSE is healthy
  // the cache is kept fresh push-style and any timed refetch is pure
  // duplication. Poll only when SSE is off (paused / disconnected).
  const sseConnected = useSseStatusStore(
    (s) => s.sseConnectionState === "connected",
  );
  const utils = api.useUtils();
  const queryClient = useQueryClient();

  // Raw useQuery on the tRPC `spanTree` key: the cache entry (and all the
  // seeding / invalidation machinery pointed at it) is unchanged, but the
  // fetch pages through `spanTreePaginated` so huge traces stream in page
  // by page instead of arriving as one unbounded response.
  const treeQuery = useQuery({
    queryKey: spanTreeQueryKey(queryArgs),
    queryFn: spanTreeQueryFn({ utils, queryClient, input: queryArgs }),
    // Disable the real fetch when the traceId is a preview-mode
    // synthetic — `useOpenTraceDrawer` has already seeded the cache
    // with hand-crafted span data; firing a real request would just
    // return empty and clobber the seed.
    enabled: isReady,
    staleTime: 300_000,
    cacheTime: 1_800_000,
    keepPreviousData: true,
    refetchOnWindowFocus: true,
  });

  // Live fallback while SSE is down: poll `spanTreeDelta` from the loaded
  // tree's high-water mark and merge new spans in place. Re-running the
  // tree query instead would restart the whole page walk every interval —
  // hundreds of requests per poll on exactly the huge live traces paging
  // exists for. Trade-off: a span re-emitted with an *earlier* corrected
  // start time is invisible to the delta filter until SSE reconnects and
  // its invalidation re-walks the full tree.
  // `keepPreviousData` means `data` can briefly be the PREVIOUS trace's
  // tree right after a trace switch — its high-water mark would make the
  // delta poll skip this trace's spans, so wait for current data.
  const tree = treeQuery.isPreviousData ? undefined : treeQuery.data;
  api.tracesV2.spanTreeDelta.useQuery(
    {
      ...queryArgs,
      sinceStartTimeMs: tree !== undefined ? spanTreeDeltaSinceMs(tree) : 0,
    },
    {
      // Gated on the tree having loaded: until then the main query's own
      // fetch (and its retries) is the source of truth, and there is no
      // high-water mark to poll from.
      enabled: isReady && isLive && !sseConnected && tree !== undefined,
      refetchInterval: LIVE_REFETCH_MS,
      // Deltas are throwaway transport into the spanTree cache entry —
      // don't retain per-poll entries of their own.
      cacheTime: 0,
      onSuccess: (delta) => {
        const queryKey = spanTreeQueryKey(queryArgs);
        const existing = queryClient.getQueryData<SpanTreeNode[]>(queryKey);
        if (!existing) return;
        const merged = mergeSpanTreeDelta(existing, delta);
        if (merged !== existing) queryClient.setQueryData(queryKey, merged);
      },
    },
  );

  return treeQuery;
}
