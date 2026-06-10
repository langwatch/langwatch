import { api } from "~/utils/api";
import { LIVE_REFETCH_MS } from "../constants/freshness";
import { useSseStatusStore } from "../stores/sseStatusStore";
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

  return api.tracesV2.spanTree.useQuery(queryArgs, {
    // Disable the real tRPC fetch when the traceId is a
    // preview-mode synthetic — `useOpenTraceDrawer` has already
    // seeded the cache with hand-crafted span data; firing a real
    // request would just return empty and clobber the seed.
    enabled: isReady,
    staleTime: 300_000,
    cacheTime: 1_800_000,
    keepPreviousData: true,
    refetchOnWindowFocus: true,
    refetchInterval: isLive && !sseConnected ? LIVE_REFETCH_MS : false,
  });
}
