import { api } from "../trace-api.ts";
import { useTraceQueryArgs } from "./use-trace-query-args.ts";

/** The open trace's agent call graph, read only while `enabled` (the Agents tab is open). */
export function useAgentCallGraph({ enabled }: { enabled: boolean }) {
  const { isReady, queryArgs } = useTraceQueryArgs();
  return api.traces.agentCallGraph.useQuery(queryArgs, {
    enabled: isReady && enabled,
    gcTime: 1_800_000,
  });
}
