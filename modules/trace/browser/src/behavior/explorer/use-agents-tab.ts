import type { AgentCallGraph, SpanTreeNode } from "@langwatch/trace-contract";
import { useMemo } from "react";

import { mayHaveSeveralAgents } from "../../model/agent-call-graph-layout.ts";
import { useAgentCallGraph } from "./use-agent-call-graph.ts";

export interface AgentsTab {
  showsAgents: boolean;
  /** True once the tab's visibility is final: no agent signal, a failed read, or the graph. */
  isSettled: boolean;
  graph: AgentCallGraph | undefined;
  isGraphError: boolean;
  retryGraph: () => void;
}

/**
 * Whether the Agents tab shows, from the span tree's agent names and A2A marks.
 * The graph loads only once the tab opens; a read-only trace never shows the tab.
 * Once offered the tab stays, even when the graph comes back with one agent.
 */
export function useAgentsTab({
  spanTree,
  isSpanTreeLoading,
  isAgentsTabOpen,
}: {
  spanTree: readonly SpanTreeNode[];
  isSpanTreeLoading: boolean;
  isAgentsTabOpen: boolean;
}): AgentsTab {
  const maySeveral = useMemo(() => mayHaveSeveralAgents({ spans: spanTree }), [spanTree]);
  const { isReady, query } = useAgentCallGraph({ enabled: isAgentsTabOpen && maySeveral });
  const graph = query.data;
  const isGraphError = query.isError;
  const isSettled =
    !isReady || graph !== undefined || isGraphError || (!isSpanTreeLoading && !maySeveral);
  return {
    showsAgents: isReady && maySeveral,
    isSettled,
    graph,
    isGraphError,
    retryGraph: () => void query.refetch(),
  };
}
