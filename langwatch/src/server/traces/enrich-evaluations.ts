import type { Evaluation, Trace } from "~/server/tracer/types";

/**
 * Merge evaluations from traceChecks into trace objects.
 *
 * TraceService returns evaluations separately in `traceChecks`; this function
 * attaches them to each trace's `evaluations` array for serialization.
 */
export function enrichTracesWithEvaluations({
  traces,
  traceChecks,
}: {
  traces: Trace[];
  traceChecks: Record<string, Evaluation[]>;
}): Trace[] {
  return traces.map((trace) => {
    const existingEvals = trace.evaluations ?? [];
    const externalEvals = traceChecks[trace.trace_id] ?? [];

    // Merge, deduplicating by evaluation_id
    const evalMap = new Map(existingEvals.map((e) => [e.evaluation_id, e]));
    for (const ext of externalEvals) {
      if (!evalMap.has(ext.evaluation_id)) {
        evalMap.set(ext.evaluation_id, ext);
      }
    }

    return {
      ...trace,
      evaluations: Array.from(evalMap.values()),
    };
  });
}
