import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "~/utils/api";
import { LIVE_REFETCH_MS } from "../constants/freshness";
import { useSseStatusStore } from "../stores/sseStatusStore";
import { spanTreeQueryFn, spanTreeQueryKey } from "./spanTreePagedQuery";
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
  return useQuery({
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
    refetchInterval: isLive && !sseConnected ? LIVE_REFETCH_MS : false,
  });
}
