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

/**
 * Whether the viz pane offers the Agents tab: when it shows, or while it is the
 * selected tab and its visibility is not final yet (the span tree still loading).
 */
export function keepsAgentsTab({
  isAgentsSelected,
  showsAgents,
  isSettled,
}: {
  isAgentsSelected: boolean;
  showsAgents: boolean;
  isSettled: boolean;
}): boolean {
  return showsAgents || (isAgentsSelected && !isSettled);
}

/** A graph worth drawing has more than one agent. */
export function hasMultipleAgents({
  graph,
}: {
  graph: AgentCallGraph | null | undefined;
}): boolean {
  return (graph?.nodes.length ?? 0) > 1;
}

type Adjacency = Map<string, string[]>;

/** Callees per node, ignoring self calls and edges to nodes not in the graph. */
function calleesOf(graph: AgentCallGraph): Adjacency {
  const out: Adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    if (edge.from !== edge.to && out.has(edge.to)) out.get(edge.from)?.push(edge.to);
  }
  return out;
}

/** Depth-first from `root`; an edge back to a node still open closes a cycle and is dropped. */
function walkForward({
  root,
  out,
  state,
  forward,
  postorder,
}: {
  root: string;
  out: Adjacency;
  state: Map<string, "open" | "done">;
  forward: Adjacency;
  postorder: string[];
}): void {
  state.set(root, "open");
  const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
  for (let top = stack.at(-1); top; top = stack.at(-1)) {
    const child = out.get(top.id)?.[top.next++];
    if (child === undefined) {
      state.set(top.id, "done");
      postorder.push(top.id);
      stack.pop();
      continue;
    }
    if (state.get(child) === "open") continue;
    forward.get(top.id)?.push(child);
    if (state.has(child)) continue;
    state.set(child, "open");
    stack.push({ id: child, next: 0 });
  }
}

/**
 * Columns of nodes: callers left of callees, by the longest call path from a root.
 * Roots are nodes nobody calls, then nodes in graph order (the trace's root first),
 * so a call back to a caller never moves the caller right.
 */
export function layerAgentCallGraph({ graph }: { graph: AgentCallGraph }): AgentCallGraphNode[][] {
  const ids = graph.nodes.map((node) => node.id);
  const out = calleesOf(graph);
  const called = new Set([...out.values()].flat());
  const state = new Map<string, "open" | "done">();
  const forward: Adjacency = new Map(ids.map((id) => [id, []]));
  const postorder: string[] = [];
  for (const root of [...ids.filter((id) => !called.has(id)), ...ids]) {
    if (!state.has(root)) walkForward({ root, out, state, forward, postorder });
  }
  const layerOf = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const id of postorder.toReversed()) {
    const next = (layerOf.get(id) ?? 0) + 1;
    for (const child of forward.get(id) ?? []) {
      layerOf.set(child, Math.max(layerOf.get(child) ?? 0, next));
    }
  }
  const layers: AgentCallGraphNode[][] = [];
  for (const node of graph.nodes) (layers[layerOf.get(node.id) ?? 0] ??= []).push(node);
  return layers.filter((layer) => layer.length > 0);
}

export type AgentNodeStatus = {
  status: "error" | "slow" | "ok";
  failedCalls: number;
  averageMs: number | null;
};

type CallTotal = { calls: number; failed: number; durationMs: number };

function callTotalsOf(graph: AgentCallGraph): Map<string, CallTotal> {
  const totals = new Map<string, CallTotal>();
  for (const edge of graph.edges) {
    const total = totals.get(edge.to) ?? { calls: 0, failed: 0, durationMs: 0 };
    total.calls += edge.callCount;
    total.failed += edge.errorCount;
    total.durationMs += edge.totalDurationMs;
    totals.set(edge.to, total);
  }
  return totals;
}

const averageOf = (total: CallTotal | undefined): number | null =>
  total && total.calls > 0 ? total.durationMs / total.calls : null;

/** The callee with the highest average latency and no failed calls, among two or more. */
function slowestCalleeOf(totals: Map<string, CallTotal>): string | null {
  if (totals.size < 2) return null;
  let slowest: { id: string; averageMs: number } | null = null;
  for (const [id, total] of totals) {
    const averageMs = averageOf(total) ?? 0;
    const isSlower = !slowest || averageMs > slowest.averageMs;
    if (total.failed === 0 && averageMs > 0 && isSlower) slowest = { id, averageMs };
  }
  return slowest?.id ?? null;
}

/** Per node, the calls into it: "error" with failed calls, "slow" for the slowest clean callee. */
export function agentNodeStatusesOf({
  graph,
}: {
  graph: AgentCallGraph;
}): Map<string, AgentNodeStatus> {
  const totals = callTotalsOf(graph);
  const slowest = slowestCalleeOf(totals);
  const statuses = new Map<string, AgentNodeStatus>();
  for (const node of graph.nodes) {
    const total = totals.get(node.id);
    const failedCalls = total?.failed ?? 0;
    let status: AgentNodeStatus["status"] = "ok";
    if (failedCalls > 0) status = "error";
    else if (slowest === node.id) status = "slow";
    statuses.set(node.id, { status, failedCalls, averageMs: averageOf(total) });
  }
  return statuses;
}
