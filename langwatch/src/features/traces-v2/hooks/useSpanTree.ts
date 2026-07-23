import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import { LIVE_REFETCH_MS } from "../constants/freshness";
import {
  asSharedQueryResult,
  useSharedTrace,
} from "../context/SharedTraceContext";
import { useSseStatusStore } from "../stores/sseStatusStore";
import {
  mergeSpanTreeDelta,
  spanTreeDeltaSinceMs,
  spanTreeQueryFn,
  spanTreeQueryKey,
} from "./spanTreePagedQuery";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

export function useSpanTree() {
  const shared = useSharedTrace();
  const { isLive, isReady, queryArgs } = useTraceQueryArgs();
  // SSE health decides the delta poll's CADENCE, not whether it runs at all.
  // While SSE is up, `useTraceFreshness` invalidates the delta on each
  // `span.stored` event and the merge happens push-style, so a timer would be
  // pure duplication; while SSE is down there is nothing to push, so it falls
  // back to an interval.
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
    // return empty and clobber the seed. A shared trace carries its
    // spans in the share payload, so there is nothing to walk and no
    // authenticated endpoint to walk it with.
    enabled: isReady && !shared,
    staleTime: 300_000,
    cacheTime: 1_800_000,
    keepPreviousData: true,
    refetchOnWindowFocus: true,
  });

  // Live updates arrive as deltas merged into the assembled tree, never as a
  // re-walk: re-running the tree query would restart the whole page walk —
  // `ceil(N/500)` sequential requests on exactly the huge live traces paging
  // exists for. This is the single update path for both SSE states; only the
  // trigger differs (SSE event vs. interval, see `refetchInterval` below).
  //
  // `keepPreviousData` means `data` can briefly be the PREVIOUS trace's tree
  // right after a trace switch — its high-water mark would make the delta
  // poll skip this trace's spans, so wait for current data.
  const tree = treeQuery.isPreviousData ? undefined : treeQuery.data;
  api.tracesV2.spanTreeDelta.useQuery(
    {
      ...queryArgs,
      sinceUpdatedAtMs: tree !== undefined ? spanTreeDeltaSinceMs(tree) : 0,
    },
    {
      // Gated on the walk having FINISHED, not merely on `tree` being
      // defined: progressive publishing sets the cache entry after page 1, so
      // a mid-walk poll would take its high-water mark from a partial tree and
      // ask for every span after it — one response of up to
      // MAX_LIGHT_SPAN_READ_ROWS, i.e. exactly the unbounded fetch paging
      // exists to avoid. Until the walk lands, the main query is the source of
      // truth (and its retries have no high-water mark to poll from anyway).
      enabled:
        isReady &&
        isLive &&
        !shared &&
        tree !== undefined &&
        !treeQuery.isFetching,
      // Only when SSE can't push. With SSE up, `useTraceFreshness` invalidates
      // this query per `span.stored` batch, which refetches it on the spot.
      refetchInterval: sseConnected ? false : LIVE_REFETCH_MS,
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

  // One catch-up delta when SSE comes back. While it was down the interval
  // was doing the polling; once it reconnects the interval stops and updates
  // arrive as events — but a span that landed between the final poll and the
  // reconnect produces no event of its own, so without this it would sit
  // unseen until the next unrelated batch (or forever, on a trace that just
  // finished). The high-water mark makes this exact, not a re-walk.
  const wasSseConnected = useRef(sseConnected);
  useEffect(() => {
    const reconnected = sseConnected && !wasSseConnected.current;
    wasSseConnected.current = sseConnected;
    if (!reconnected || !isReady || !isLive || shared) return;
    void utils.tracesV2.spanTreeDelta.invalidate({
      projectId: queryArgs.projectId,
      traceId: queryArgs.traceId,
    });
  }, [
    sseConnected,
    isReady,
    isLive,
    shared,
    utils,
    queryArgs.projectId,
    queryArgs.traceId,
  ]);

  if (shared) {
    return asSharedQueryResult(shared.spanTree) as unknown as typeof treeQuery;
  }
  return treeQuery;
}
