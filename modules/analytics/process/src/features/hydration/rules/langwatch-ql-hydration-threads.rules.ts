/**
 * A thread's traces in the order they happened, and the cut a judgement reads
 * up to. Ordered here rather than trusted from the read: the value is a
 * transcript, and one in the wrong order is wrong in a way no reader detects.
 * @see specs/lwql/app-functions.feature
 */

import type { Trace } from "@langwatch/trace-contract";

/** Oldest first; ties fall back to the trace id so two runs render alike. */
export function orderThreadTraces(traces: readonly Trace[]): readonly Trace[] {
  return traces.toSorted((a, b) => {
    const byTime = a.timestamps.started_at - b.timestamps.started_at;
    if (byTime !== 0) return byTime;

    return a.trace_id.localeCompare(b.trace_id);
  });
}

/**
 * The thread up to and including one trace, so a judgement reads only what the
 * agent had seen. An id the thread does not contain leaves it whole: an empty
 * transcript would read as "nothing in here" for a mistyped id.
 */
export function threadTracesUntil({
  traces,
  untilTraceId,
}: {
  traces: readonly Trace[];
  untilTraceId: string;
}): readonly Trace[] {
  if (untilTraceId === "") return traces;
  const cut = traces.findIndex((trace) => trace.trace_id === untilTraceId);

  return cut < 0 ? traces : traces.slice(0, cut + 1);
}

/** The thread's trace ids, oldest first — the `thread_traces` value. */
export function threadTraceIds({ traces }: { traces: readonly Trace[] }): readonly string[] {
  return orderThreadTraces(traces).map((trace) => trace.trace_id);
}
