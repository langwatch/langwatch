import type { TraceEvalResult, TraceListItem } from "../types/trace";
import { NO_TRACE_EVENTS } from "../types/trace";

interface TraceListPayload {
  items: unknown[];
}

/**
 * Normalize the raw `tracesV2.list` payload into `TraceListItem` rows:
 * narrow each row's evaluations to what a cell renders and default the
 * optional spanCount field. Each row carries its own evaluations, matched
 * by project and trace id on the server, so two rows with the same trace id
 * (an aggregate's members) never share them.
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
  return (data.items as TraceListItem[]).map((item) => ({
    ...item,
    spanCount: item.spanCount ?? 0,
    sizeBytes: item.sizeBytes ?? 0,
    evaluations: ((item.evaluations ?? []) as TraceEvalResult[]).map((e) => ({
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
