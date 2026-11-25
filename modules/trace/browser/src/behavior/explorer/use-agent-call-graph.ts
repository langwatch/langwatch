import { api } from "../trace-api.ts";
import { useTraceQueryArgs } from "./use-trace-query-args.ts";

/**
 * The open trace's agent call graph, read only while `enabled` (the Agents tab is open).
 * `isReady` is false where the drawer reads nothing, such as a read-only shared trace.
 */
export function useAgentCallGraph({ enabled }: { enabled: boolean }) {
  const { isReady, queryArgs } = useTraceQueryArgs();
  const query = api.traces.agentCallGraph.useQuery(queryArgs, {
    enabled: isReady && enabled,
    gcTime: 1_800_000,
  });
  return { isReady, query };
}
