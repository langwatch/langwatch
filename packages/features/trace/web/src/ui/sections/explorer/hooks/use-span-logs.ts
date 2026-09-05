import { useMemo } from "react";
import type { TraceLogRecordDto } from "@langwatch/trace-contract";
import { api } from "../../../../behavior/trace-api";
import { useTraceQueryArgs } from "./use-trace-query-args";

/**
 * The open drawer trace's log records, grouped by the span that emitted them.
 */
export function useSpanLogs() {
  const { isReady, queryArgs } = useTraceQueryArgs();

  // Observer only (`enabled: false` never fetches): the drawer scaffold
  // always runs the real header query, this just follows its cache entry.
  // full: true matches useTraceHeader's own query key, or this would watch
  // a cache slot the scaffold's query never populates.
  const header = api.tracesV2.header.useQuery({ ...queryArgs, full: true }, { enabled: false });
  const logRecordCount = Number(
    header.data?.attributes["langwatch.reserved.log_record_count"] ?? "0",
  );
  // The origin fallback covers coding-agent traces whose logs predate the
  // summary fold's count stamping — exactly the traces where logs carry the
  // transcript and tool activity, so failing open for them is the right bias.
  const mayHaveLogs = logRecordCount > 0 || header.data?.origin === "coding_agent";

  const query = api.tracesV2.traceLogs.useQuery(queryArgs, {
    enabled: isReady && mayHaveLogs,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const logsBySpanId = useMemo(() => groupLogsBySpanId(query.data ?? []), [query.data]);

  return { ...query, logsBySpanId };
}

export function groupLogsBySpanId(logs: TraceLogRecordDto[]): Map<string, TraceLogRecordDto[]> {
  const map = new Map<string, TraceLogRecordDto[]>();
  for (const log of logs) {
    if (!log.spanId) continue;
    const list = map.get(log.spanId);
    if (list) list.push(log);
    else map.set(log.spanId, [log]);
  }
  return map;
}
