import type { TraceHeader, TraceHeaderReadInput } from "@langwatch/trace-contract";

import { traceApi } from "../../behavior/trace-api.ts";

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
}: TraceHeaderReadInput & {
  full: boolean;
  /** Hold the read off until the caller has what it needs to ask. */
  enabled?: boolean;
}): UseTraceHeaderResult {
  const query = traceApi.traces.header.useQuery(
    {
      projectId,
      traceId,
      ...(occurredAtMs !== void 0 ? { occurredAtMs } : {}),
      full,
    },
    { enabled: enabled && projectId.length > 0 && traceId.length > 0 },
  );

  return { header: query.data, isLoading: query.isLoading };
}
