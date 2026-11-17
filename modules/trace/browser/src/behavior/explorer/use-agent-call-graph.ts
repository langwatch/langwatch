import { api } from "../trace-api.ts";
import { useTraceQueryArgs } from "./use-trace-query-args.ts";

/** The open trace's agent call graph: which agent called which, across A2A hops. */
export function useAgentCallGraph() {
  const { isReady, queryArgs } = useTraceQueryArgs();
  return api.traces.agentCallGraph.useQuery(queryArgs, {
    enabled: isReady,
    gcTime: 1_800_000,
  });
}
