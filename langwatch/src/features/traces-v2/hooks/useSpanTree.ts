import { api } from "~/utils/api";
import { LIVE_REFETCH_MS } from "../constants/freshness";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

export function useSpanTree() {
  const { isLive, isReady, queryArgs } = useTraceQueryArgs();

  // Match useTraceHeader's liveness behaviour so spans + header refresh
  // together as new spans arrive on a recent trace.
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
    refetchInterval: isLive ? LIVE_REFETCH_MS : false,
  });
}
