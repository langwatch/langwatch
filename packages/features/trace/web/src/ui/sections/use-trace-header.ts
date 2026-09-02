import type { TraceHeader, TraceHeaderReadInput } from "@langwatch/trace-contract";
import { traceApi } from "./trace-api";

export type UseTraceHeaderResult = {
  header: TraceHeader | undefined;
  isLoading: boolean;
};

/**
 * EXTERNAL. What is this trace?
 *
 * Anything may ask Trace this — a Langy context chip, a Scenario run row, an
 * Experiment target cell — so it is exported from this package's `src/index.ts`
 * and its shape is a contract. `TraceHeader` and `TraceHeaderReadInput` both
 * come from `@langwatch/trace-contract` for exactly that reason: a caller in
 * another feature can name the argument and the answer without depending on
 * anything of Trace's beyond the contract it already depends on.
 *
 * `full` is what a caller pays for. `true` resolves offloaded (ADR-022)
 * input/output at the cost of one extra spans read, and only a surface that
 * shows or exports untruncated content should ask for it. It has no default
 * here on purpose: the procedure defaults it to `true`, and inheriting that
 * silently is how a hover-peek ends up paying a drawer's price.
 *
 * The read shares a cache entry with every other reader of `tracesV2.header`,
 * including the ones still in the application, so calling this twice on one
 * screen costs one request.
 */
export function useTraceHeader({
  projectId,
  traceId,
  occurredAtMs,
  full,
  enabled = true,
  staleTimeMs = 300_000,
}: TraceHeaderReadInput & {
  full: boolean;
  /** Hold the read off until the caller has what it needs to ask. */
  enabled?: boolean;
  staleTimeMs?: number;
}): UseTraceHeaderResult {
  const query = traceApi.tracesV2.header.useQuery(
    {
      projectId,
      traceId,
      ...(occurredAtMs !== void 0 ? { occurredAtMs } : {}),
      full,
    },
    { enabled: enabled && projectId.length > 0 && traceId.length > 0, staleTime: staleTimeMs },
  );

  return { header: query.data, isLoading: query.isLoading };
}
