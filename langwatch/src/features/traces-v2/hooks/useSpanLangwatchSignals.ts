import { useMemo } from "react";
import type { LangwatchSignalBucket } from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import { LIVE_REFETCH_MS } from "../constants/freshness";
import {
  asSharedQueryResult,
  useSharedTrace,
} from "../context/SharedTraceContext";
import { useSseStatusStore } from "../stores/sseStatusStore";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/**
 * Secondary signal-detection query for the open drawer trace. Fired in
 * parallel with `useSpanTree` so the cheap waterfall/list payload renders
 * first and the badges + "Only LangWatch spans" filter light up once this
 * resolves. Returns a Map<spanId, signals[]> for O(1) row lookup.
 */
export function useSpanLangwatchSignals() {
  const shared = useSharedTrace();
  const { isLive, isReady, queryArgs } = useTraceQueryArgs();
  // SSE-aware polling (see `useSpanTree` for the rationale): poll only
  // when `useTraceFreshness`'s SSE subscription isn't keeping the cache
  // fresh via invalidations.
  const sseConnected = useSseStatusStore(
    (s) => s.sseConnectionState === "connected",
  );

  const query = api.tracesV2.spanLangwatchSignals.useQuery(queryArgs, {
    enabled: isReady && !shared,
    staleTime: 300_000,
    cacheTime: 1_800_000,
    keepPreviousData: true,
    refetchOnWindowFocus: true,
    refetchInterval: isLive && !sseConnected ? LIVE_REFETCH_MS : false,
  });

  const rows = shared?.spanSignals ?? query.data;
  const signalsBySpanId = useMemo(() => {
    const map = new Map<string, LangwatchSignalBucket[]>();
    for (const row of rows ?? []) {
      map.set(row.spanId, row.signals);
    }
    return map;
  }, [rows]);

  const base = (
    shared ? asSharedQueryResult(shared.spanSignals) : query
  ) as unknown as typeof query;
  return { ...base, signalsBySpanId };
}
