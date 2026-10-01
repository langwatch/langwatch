import type { LangwatchSignalBucket } from "@langwatch/trace-contract";
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";

import { api } from "../../../../behavior/trace-api.ts";
import { useTraceQueryArgs } from "./use-trace-query-args.ts";

/**
 * Secondary signal-detection query for the open drawer trace. Fired in parallel with
 * `useSpanTree` so the cheap waterfall/list payload renders first and the badges +
 * "Only LangWatch spans" filter light up once this resolves.
 */
export function useSpanLangwatchSignals() {
  const { isReady, hintReady, queryArgs } = useTraceQueryArgs();

  const query = api.traces.spanLangwatchSignals.useQuery(queryArgs, {
    enabled: isReady && hintReady,
    gcTime: 1_800_000,
    placeholderData: keepPreviousData,
  });

  const rows = query.data;
  const signalsBySpanId = useMemo(() => {
    const map = new Map<string, LangwatchSignalBucket[]>();
    for (const row of rows ?? []) {
      map.set(row.spanId, row.signals);
    }
    return map;
  }, [rows]);

  return { ...query, signalsBySpanId };
}
