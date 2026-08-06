import type { TraceEvalResult, TraceListItem } from "../types/trace";
import { NO_TRACE_EVENTS } from "../types/trace";

interface TraceListPayload {
  items: unknown[];
  evaluations?: Record<string, TraceEvalResult[]> | null;
}

/**
 * Normalize the raw `tracesV2.list` payload into `TraceListItem` rows:
 * attach each trace's evaluations and default the optional spanCount field.
 * Shared by the full /traces list (`useTraceListQuery`) and the compact
 * personal recent-activity table so both render identical rows from the
 * same source.
 *
 * Rows start eventless: events are not on the trace summary, so the list
 * reads them separately (`useTraceListEvents`) and merges them in.
 */
export function mapTraceListPayload(
  data: TraceListPayload | undefined,
): TraceListItem[] {
  if (!data) return [];
  const evalMap = (data.evaluations ?? {}) as Record<string, TraceEvalResult[]>;
  return (data.items as TraceListItem[]).map((item) => ({
    ...item,
    spanCount: item.spanCount ?? 0,
    sizeBytes: item.sizeBytes ?? 0,
    evaluations: (evalMap[item.traceId] ?? []).map((e) => ({
      evaluatorId: e.evaluatorId,
      evaluatorName: e.evaluatorName,
      status: e.status,
      score: e.score,
      passed: e.passed,
      label: e.label,
    })),
    events: item.events ?? NO_TRACE_EVENTS,
  }));
}
