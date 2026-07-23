import { useMemo } from "react";
import type { TraceLogRecordDto } from "~/server/api/routers/tracesV2";
import { api } from "~/utils/api";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/**
 * The open drawer trace's log records, grouped by the span that emitted them.
 *
 * A span can carry activity that never shows up in its own input/output —
 * a tool the user denied, an API retry, a mid-session compaction — because
 * those things only exist as log records, correlated back to the span by
 * `spanId`. The waterfall row uses this to flag which spans have logs at
 * all; the span detail's Logs section uses it to show them.
 *
 * Gated on the header's log-record count so the MAJORITY of traces (ordinary
 * LLM traces with zero logs) never pay a ClickHouse `traceLogs` query just to
 * compute an empty log-count icon on drawer open. Shares its query key with
 * the Terminal/Session tabs' own `traceLogs` read, so opening this trace's
 * waterfall after (or before) either tab costs no extra network round-trip.
 */
export function useSpanLogs() {
  const { isReady, queryArgs } = useTraceQueryArgs();

  // Observer only (`enabled: false` never fetches): the drawer scaffold
  // always runs the real header query, this just follows its cache entry.
  const header = api.tracesV2.header.useQuery(queryArgs, { enabled: false });
  const logRecordCount = Number(
    header.data?.attributes["langwatch.reserved.log_record_count"] ?? "0",
  );
  // The origin fallback covers coding-agent traces whose logs predate the
  // summary fold's count stamping — exactly the traces where logs carry the
  // transcript and tool activity, so failing open for them is the right bias.
  const mayHaveLogs =
    logRecordCount > 0 || header.data?.origin === "coding_agent";

  const query = api.tracesV2.traceLogs.useQuery(queryArgs, {
    enabled: isReady && mayHaveLogs,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const logsBySpanId = useMemo(
    () => groupLogsBySpanId(query.data ?? []),
    [query.data],
  );

  return { ...query, logsBySpanId };
}

export function groupLogsBySpanId(
  logs: TraceLogRecordDto[],
): Map<string, TraceLogRecordDto[]> {
  const map = new Map<string, TraceLogRecordDto[]>();
  for (const log of logs) {
    if (!log.spanId) continue;
    const list = map.get(log.spanId);
    if (list) list.push(log);
    else map.set(log.spanId, [log]);
  }
  return map;
}
