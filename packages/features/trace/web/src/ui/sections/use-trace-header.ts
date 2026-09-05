import type { TraceHeader, TraceHeaderReadInput } from "@langwatch/trace-contract";
import { traceApi } from "../../behavior/trace-api";

export type UseTraceHeaderResult = {
  header: TraceHeader | undefined;
  isLoading: boolean;
};

/**
 * EXTERNAL. What is this trace?
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
