import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import { api } from "~/utils/api";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

export interface TraceEventsResult {
  events: DerivedTraceEvent[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Trace-level events for the drawer, fetched as its own query (like
 * `useTraceEvaluations`) rather than riding on the header. The header stays a
 * pure summary read; this reads only the `Events.*` columns from stored_spans.
 * Split off the drawer batch so it doesn't block the other per-trace queries.
 */
export function useTraceEvents(): TraceEventsResult {
  const { isReady, queryArgs } = useTraceQueryArgs();

  const query = api.tracesV2.traceEvents.useQuery(queryArgs, {
    enabled: isReady,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    trpc: { context: { skipBatch: true } },
  });

  return {
    events: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
