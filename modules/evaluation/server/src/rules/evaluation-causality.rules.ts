import type { Trace } from "@langwatch/trace-contract";

const TRACE_ID_HEX = /^[0-9a-fA-F]{32}$/;
const SPAN_ID_HEX = /^[0-9a-fA-F]{16}$/;

function pickCausalityDepth(span: {
  params?: Record<string, unknown> | null;
  attributes?: Record<string, unknown> | null;
}): unknown {
  // Real production path: unflattened in params.langwatch.causality_depth.
  const params = (span.params ?? null) as Record<string, unknown> | null;
  if (params) {
    const ns = params.langwatch as Record<string, unknown> | undefined;
    if (ns && ns.causality_depth !== undefined) {
      return ns.causality_depth;
    }

    if (params["langwatch.causality_depth"] !== undefined) {
      return params["langwatch.causality_depth"];
    }
  }

  // Legacy / synthetic test path.
  const attrs = (span.attributes ?? null) as Record<string, unknown> | null;
  if (attrs && attrs["langwatch.causality_depth"] !== undefined) {
    return attrs["langwatch.causality_depth"];
  }

  return undefined;
}

/**
 * Extract the W3C `traceparent` context for the eval workflow from the parent trace. nlpgo
 * needs both pieces (32-hex trace_id + 16-hex root span_id) so its emitted spans land as
 * children of the parent trace in Studio's waterfall rather than as a separate orphan trace.
 */
export function tryExtractParentTraceForNlpgo(
  trace: Trace | undefined,
): { traceId: string; parentSpanId: string } | undefined {
  if (!trace?.trace_id || !TRACE_ID_HEX.test(trace.trace_id)) {
    return undefined;
  }

  // Broken / multi-source instrumentation can leave a trace with more than one parent-less
  // span. `find()` would then pick whichever span happened to be ingested first —
  // non-deterministic across re-runs. Sort by started_at (earliest is the true root in any
  // sane trace) with span_id as the tie-breaker to keep two consecutive eval runs pinned to
  // the same parent_span_id.
  const rootCandidates = (trace.spans ?? []).filter((s) => !s.parent_id);
  if (rootCandidates.length === 0) {
    return undefined;
  }

  rootCandidates.sort((a, b) => {
    const aStart = a.timestamps?.started_at ?? Number.MAX_SAFE_INTEGER;
    const bStart = b.timestamps?.started_at ?? Number.MAX_SAFE_INTEGER;
    if (aStart !== bStart) {
      return aStart - bStart;
    }

    return (a.span_id ?? "").localeCompare(b.span_id ?? "");
  });
  const rootSpan = rootCandidates[0];
  if (!rootSpan?.span_id || !SPAN_ID_HEX.test(rootSpan.span_id)) {
    return undefined;
  }

  return {
    traceId: trace.trace_id.toLowerCase(),
    parentSpanId: rootSpan.span_id.toLowerCase(),
  };
}

/**
 * Returns the max `langwatch.causality_depth` across the supplied spans (0 if absent on all).
 * The dispatcher uses this to pass the parent depth to nlpgo, which increments and stamps on
 * every span it emits.
 */
export function maxCausalityDepthOfSpans(
  spans:
    | Array<{
        params?: Record<string, unknown> | null;
        attributes?: Record<string, unknown> | null;
      }>
    | undefined
    | null,
): number {
  if (!spans || spans.length === 0) {
    return 0;
  }

  let max = 0;
  for (const span of spans) {
    const raw = pickCausalityDepth(span);
    if (raw === undefined || raw === null) {
      continue;
    }

    const n =
      typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }

  return max;
}
