/**
 * attachAnnotationsToTraces — joins reviewer annotations onto the traces that
 * are about to be mapped into dataset columns.
 *
 * `TRACE_MAPPINGS.annotations` (src/server/tracer/tracesMapping.ts) already
 * offers `comment`, `is_thumbs_up`, `author`, `score`, `score.reason` and
 * `expected_output` as mappable fields, and reads them off `trace.annotations`.
 * Nothing ever put anything there: `TraceWithAnnotations` appeared in that one
 * file, and `getTracesWithSpans` — what the add-to-dataset drawer fetches with
 * — does not return annotations. So every one of those fields silently
 * resolved to `undefined`, and a user who mapped "expected_output" got an
 * empty column with no error to explain it.
 *
 * This is the join that was missing. It matters beyond filling a column:
 * `expectedOutput` is a human-written correct answer, so once it reaches a
 * dataset, judges can be run against it as ordinary targets and ranked on the
 * existing leaderboard — no bespoke agreement machinery required.
 */

import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";

/** The shape both sides agree on: anything carrying a trace id. */
type TraceLike = { trace_id: string };

export const attachAnnotationsToTraces = <T extends TraceLike>({
  traces,
  annotations,
}: {
  traces: T[];
  annotations: AnnotationByTrace[];
}): (T & { annotations: AnnotationByTrace[] })[] => {
  // Group once rather than filtering the annotation list per trace — the
  // drawer can be opened on a whole conversation, so this is O(n+m) instead
  // of O(n*m).
  const byTraceId = new Map<string, AnnotationByTrace[]>();
  for (const annotation of annotations) {
    const existing = byTraceId.get(annotation.traceId);
    if (existing) {
      existing.push(annotation);
    } else {
      byTraceId.set(annotation.traceId, [annotation]);
    }
  }

  return traces.map((trace) => ({
    ...trace,
    // Always an array, never undefined: the mapping iterates this directly,
    // and an absent key there is what produced the silent empty column.
    annotations: byTraceId.get(trace.trace_id) ?? [],
  }));
};
