import { api } from "../trace-api.ts";
import { useTraceQueryArgs } from "./use-trace-query-args.ts";

/** The open trace's agent call graph: which agent called which, across A2A hops. */
export function useAgentCallGraph() {
  const { isReady, queryArgs } = useTraceQueryArgs();
  return api.traces.agentCallGraph.useQuery(queryArgs, {
    enabled: isReady,
    // Span-stored events invalidate it, so a reopened drawer reuses the cached graph.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1_800_000,
  });
}
