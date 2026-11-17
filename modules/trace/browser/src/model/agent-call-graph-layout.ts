import type { AgentCallGraph, AgentCallGraphNode } from "@langwatch/trace-contract";

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
