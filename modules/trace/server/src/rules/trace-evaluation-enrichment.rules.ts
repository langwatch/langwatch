import type { Evaluation, Trace } from "@langwatch/trace-contract";

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
    const seen: Record<string, true> = Object.create(null);
    const merged: Evaluation[] = [];
    for (const evaluation of [...existingEvals, ...externalEvals]) {
      if (seen[evaluation.evaluation_id] === true) continue;
      seen[evaluation.evaluation_id] = true;
      merged.push(evaluation);
    }

    return {
      ...trace,
      evaluations: merged,
    };
  });
}
