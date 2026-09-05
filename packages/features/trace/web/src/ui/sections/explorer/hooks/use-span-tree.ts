import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { applyOverlayToSpanTreeNodes } from "../../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views";
import { api } from "../../trace-api";
import { LIVE_REFETCH_MS, useSseStatusStore } from "../../../../index";
import { asSharedQueryResult, useSharedTrace } from "../context/shared-trace-context";
import {
  mergeSpanTreeDelta,
  spanTreeDeltaSinceMs,
  spanTreeQueryFn,
  spanTreeQueryKey,
} from "./span-tree-paged-query";
import { useAppliedTraceEditPatch } from "./use-trace-edit-overlay";
import { useTraceQueryArgs } from "./use-trace-query-args";

/**
 * The span tree exactly as captured, before any correction. Read it when the
 * captured trace is the point: the Original view, the hover-original marks and
 * the difference view.
 */
export function useSpanTreeCanonical() {
  const shared = useSharedTrace();
  const { isLive, isReady, queryArgs } = useTraceQueryArgs();
  // SSE health decides the delta poll's CADENCE, not whether it runs at all.
  // While SSE is up, `useTraceFreshness` invalidates the delta on each
  // `span.stored` event and the merge happens push-style, so a timer would be
  // pure duplication; while SSE is down there is nothing to push, so it falls
  // back to an interval.
  const sseConnected = useSseStatusStore((s) => s.sseConnectionState === "connected");
  const utils = api.useUtils();
  const queryClient = useQueryClient();

  // Raw useQuery on the tRPC `spanTree` key: the cache entry (and all the
  // seeding / invalidation machinery pointed at it) is unchanged, but the
  // fetch pages through `spanTreePaginated` so huge traces stream in page
  // by page instead of arriving as one unbounded response.
  const treeQuery = useQuery({
    queryKey: spanTreeQueryKey(queryArgs),
    queryFn: spanTreeQueryFn({ utils, queryClient, input: queryArgs }),
    // Disable the real fetch when the traceId is a preview-mode synthetic —
    // `useOpenTraceDrawer` has already seeded the cache with hand-crafted span data;
    // firing a real request would just return empty and clobber the seed.
    enabled: isReady && !shared,
    staleTime: 300_000,
    gcTime: 1_800_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });

  // Live updates arrive as deltas merged into the assembled tree, never as a re-walk:
  // re-running the tree query would restart the whole page walk — `ceil(N/500)`
  // sequential requests on exactly the huge live traces paging exists for.
  const tree = treeQuery.isPlaceholderData ? undefined : treeQuery.data;
  const deltaQuery = api.tracesV2.spanTreeDelta.useQuery(
    {
      ...queryArgs,
      sinceUpdatedAtMs: tree !== undefined ? spanTreeDeltaSinceMs(tree) : 0,
    },
    {
      // Gated on the walk having FINISHED, not merely on `tree` being defined: progressive publishing sets the cache entry after page
      // 1, so a mid-walk poll would take its high-water mark from a partial tree and ask for every span after it — one response of up
      // to MAX_LIGHT_SPAN_READ_ROWS, i.e. exactly the unbounded fetch paging exists to avoid.
      enabled: isReady && isLive && !shared && tree !== undefined && !treeQuery.isFetching,
      // Only when SSE can't push. With SSE up, `useTraceFreshness` invalidates
      // this query per `span.stored` batch, which refetches it on the spot.
      refetchInterval: sseConnected ? false : LIVE_REFETCH_MS,
      // Deltas are throwaway transport into the spanTree cache entry —
      // don't retain per-poll entries of their own.
      gcTime: 0,
    },
  );

  // Per-fetch merge of the delta into the assembled tree. Keyed on
  // `dataUpdatedAt`, not on `data`: structural sharing keeps `data` identity
  // stable when a poll returns the same spans, and re-merging an already
  // merged delta is a no-op (`merged === existing`), so a spurious run cannot
  // corrupt the tree.
  const { data: delta, dataUpdatedAt: deltaUpdatedAt } = deltaQuery;
  useEffect(() => {
    if (!deltaUpdatedAt || delta === undefined) return;
    const queryKey = spanTreeQueryKey(queryArgs);
    const existing = queryClient.getQueryData<SpanTreeNode[]>(queryKey);
    if (!existing) return;
    const merged = mergeSpanTreeDelta(existing, delta);
    if (merged !== existing) queryClient.setQueryData(queryKey, merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deltaUpdatedAt]);

  // One catch-up delta when SSE comes back.
  const wasSseConnected = useRef(sseConnected);
  useEffect(() => {
    const reconnected = sseConnected && !wasSseConnected.current;
    wasSseConnected.current = sseConnected;
    if (!reconnected || !isReady || !isLive || shared) return;
    void utils.tracesV2.spanTreeDelta.invalidate({
      projectId: queryArgs.projectId,
      traceId: queryArgs.traceId,
    });
  }, [sseConnected, isReady, isLive, shared, utils, queryArgs.projectId, queryArgs.traceId]);

  if (shared) {
    return asSharedQueryResult(shared.spanTree) as unknown as typeof treeQuery;
  }
  return treeQuery;
}

/**
 * Both readings of the span tree from one read: the trace as captured, and the trace as
 * the reader sees it.
 */
export function useSpanTreeWithCaptured() {
  const captured = useSpanTreeCanonical();
  const patch = useAppliedTraceEditPatch();
  const nodes = captured.data;

  const data = useMemo(
    () => (nodes ? applyOverlayToSpanTreeNodes({ nodes, patch }) : nodes),
    [nodes, patch],
  );

  const corrected = useMemo(
    () => (data === nodes ? captured : { ...captured, data }),
    [captured, data, nodes],
  );

  // The same tree with the removed rows still on it, for the waterfall to show
  // struck through. It is what the correction did, not what the trace now is,
  // so it never stands in for `corrected`.
  const displayData = useMemo(
    () => (nodes ? applyOverlayToSpanTreeNodes({ nodes, patch, shouldKeepDeleted: true }) : nodes),
    [nodes, patch],
  );

  const display = useMemo(
    () => (displayData === nodes ? captured : { ...captured, data: displayData }),
    [captured, displayData, nodes],
  );

  return useMemo(() => ({ captured, corrected, display }), [captured, corrected, display]);
}

/**
 * The span tree the reader sees: corrected when a correction applies, captured
 * otherwise.
 */
export function useSpanTree() {
  return useSpanTreeWithCaptured().corrected;
}
