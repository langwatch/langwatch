import { useMemo } from "react";
import type { LangwatchSignalBucket } from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import { LIVE_REFETCH_MS } from "../constants/freshness";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/**
 * Secondary signal-detection query for the open drawer trace. Fired in
 * parallel with `useSpanTree` so the cheap waterfall/list payload renders
 * first and the badges + "Only LangWatch spans" filter light up once this
 * resolves. Returns a Map<spanId, signals[]> for O(1) row lookup.
 */
export function useSpanLangwatchSignals() {
  const { isLive, isReady, queryArgs } = useTraceQueryArgs();

  const query = api.tracesV2.spanLangwatchSignals.useQuery(queryArgs, {
    enabled: isReady,
    staleTime: 300_000,
    cacheTime: 1_800_000,
    keepPreviousData: true,
    refetchOnWindowFocus: true,
    refetchInterval: isLive ? LIVE_REFETCH_MS : false,
  });

  const signalsBySpanId = useMemo(() => {
    const map = new Map<string, LangwatchSignalBucket[]>();
    for (const row of query.data ?? []) {
      map.set(row.spanId, row.signals);
    }
    return map;
  }, [query.data]);

  return { ...query, signalsBySpanId };
}
