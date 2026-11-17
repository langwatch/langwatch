import type { AgentCallGraph, SpanTreeNode } from "@langwatch/trace-contract";
import { useMemo } from "react";

import { useAgentCallGraph } from "../../../../behavior/explorer/use-agent-call-graph.ts";
import {
  hasMultipleAgents,
  isAgentCallSpanName,
  mayHaveSeveralAgents,
} from "../../../../model/agent-call-graph-layout.ts";
import { useTraceResources } from "../hooks/use-trace-resources.ts";

export interface AgentsTab {
  showsAgents: boolean;
  /** True once the tab's visibility is final: no agent signal, or the graph has loaded. */
  isSettled: boolean;
  graph: AgentCallGraph | undefined;
  a2aSpanIds: ReadonlySet<string>;
}

/**
 * Whether the Agents tab shows, from the span tree and the prefetched resources.
 * The graph itself loads only once the tab opens.
 */
export function useAgentsTab({
  traceId,
  spanTree,
  isAgentsTabOpen,
}: {
  traceId: string | null | undefined;
  spanTree: readonly SpanTreeNode[];
  isAgentsTabOpen: boolean;
}): AgentsTab {
  const resources = useTraceResources(traceId);
  const maySeveral = useMemo(
    () =>
      mayHaveSeveralAgents({
        spanNames: spanTree.map((span) => span.name),
        serviceNames: resources.spans.map((row) => row.resourceAttributes["service.name"]),
      }),
    [spanTree, resources.spans],
  );
  const graph = useAgentCallGraph({ enabled: isAgentsTabOpen }).data;
  const a2aSpanIds = useMemo(
    () =>
      new Set(
        graph
          ? graph.a2aSpans.map((mark) => mark.spanId)
          : spanTree.filter((span) => isAgentCallSpanName(span.name)).map((span) => span.spanId),
      ),
    [graph, spanTree],
  );
  return {
    showsAgents: graph ? hasMultipleAgents({ graph }) : maySeveral,
    isSettled: graph !== undefined || !maySeveral,
    graph,
    a2aSpanIds,
  };
}
