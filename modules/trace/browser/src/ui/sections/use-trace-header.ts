import type { TraceHeader, TraceHeaderReadInput } from "@langwatch/trace-contract";

import { traceApi } from "../../behavior/trace-api.ts";

type UseTraceHeaderResult = {
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
  tenantId,
  enabled = true,
}: Omit<TraceHeaderReadInput, "tenantId"> & {
  full: boolean;
  /** The member that owns the trace on an aggregate (ADR-177 block F). */
  tenantId?: string | null;
  /** Hold the read off until the caller has what it needs to ask. */
  enabled?: boolean;
}): UseTraceHeaderResult {
  const query = traceApi.traces.header.useQuery(
    {
      projectId,
      traceId,
      ...(occurredAtMs !== void 0 ? { occurredAtMs } : {}),
      ...(tenantId ? { tenantId } : {}),
      full,
    },
    { enabled: enabled && projectId.length > 0 && traceId.length > 0 },
  );

  return { header: query.data, isLoading: query.isLoading };
}
