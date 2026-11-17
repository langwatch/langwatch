import type { AgentCallGraph, AgentCallGraphNode, SpanTreeNode } from "@langwatch/trace-contract";

type AgentMarks = Pick<SpanTreeNode, "spanId" | "agentName" | "isA2aCall">;

/** From the span tree alone: two agents named, or a span the server marked as an A2A call. */
export function mayHaveSeveralAgents({ spans }: { spans: readonly AgentMarks[] }): boolean {
  const names = new Set<string>();
  for (const span of spans) {
    if (span.isA2aCall) return true;
    if (span.agentName) names.add(span.agentName);
    if (names.size > 1) return true;
  }
  return false;
}

/** The span ids the server marked as A2A calls, for the span tree's label. */
export function a2aSpanIdsOf({ spans }: { spans: readonly AgentMarks[] }): ReadonlySet<string> {
  return new Set(spans.filter((span) => span.isA2aCall).map((span) => span.spanId));
}

/** A graph worth drawing has more than one agent. */
export function hasMultipleAgents({
  graph,
}: {
  graph: AgentCallGraph | null | undefined;
}): boolean {
  return (graph?.nodes.length ?? 0) > 1;
}

/** Columns of nodes: callers left of callees, by the longest call path from a root. */
export function layerAgentCallGraph({ graph }: { graph: AgentCallGraph }): AgentCallGraphNode[][] {
  const layerOf = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]));
  // Relaxing every edge once per node settles a DAG; the cap stops a cycle from looping.
  for (let pass = 0; pass < graph.nodes.length; pass++) {
    let changed = false;
    for (const edge of graph.edges) {
      if (edge.from === edge.to) continue;
      const next = (layerOf.get(edge.from) ?? 0) + 1;
      if (next > (layerOf.get(edge.to) ?? 0) && next < graph.nodes.length) {
        layerOf.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const layers: AgentCallGraphNode[][] = [];
  for (const node of graph.nodes) {
    const layer = layerOf.get(node.id) ?? 0;
    (layers[layer] ??= []).push(node);
  }
  return layers.filter((layer) => layer.length > 0);
}
