/**
 * The agent call graph of one trace (specs/agent-call-graph.feature). Each span
 * belongs to one agent; an edge is counted where a child span's agent differs
 * from its parent's. Tokens and cost are summed per agent from its own LLM spans.
 */
import { ATTR_KEYS } from "@langwatch/span-normalisation";
import {
  A2A_V0_METHODS,
  A2A_V1_METHODS,
  a2aSpanNameMatch,
  NormalizedSpanKind,
  type A2aSpanMark,
  type AgentCallGraph,
  type AgentCallGraphEdge,
  type AgentCallGraphNode,
  type SpanDetail,
  type TraceResourceInfoDto,
} from "@langwatch/trace-contract";

/** `kind` is the stored OTLP span kind; ingestion keeps it as a column, not an attribute. */
export type AgentCallGraphSpan = Pick<
  SpanDetail,
  "spanId" | "parentSpanId" | "name" | "type" | "durationMs" | "status" | "metrics" | "params"
> & { kind?: NormalizedSpanKind | null };

export type AgentCallGraphResources = Pick<TraceResourceInfoDto, "resourceAttributes" | "spans">;

/** `source` is the span that started the owner; `named` marks an A2A client's callee. */
type Owner = {
  id: string;
  label: string;
  kind: AgentCallGraphNode["kind"];
  source: string;
  named: "self" | "callee" | "none";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Reads a flat dotted key first, then the same path through nested objects. */
function attributeOf({
  params,
  key,
}: {
  params: AgentCallGraphSpan["params"];
  key: string;
}): unknown {
  if (!params) return undefined;
  if (key in params) return params[key];
  let current: unknown = params;
  for (const part of key.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

/** The attribute as text; an empty string when it is absent or not a scalar. */
function textAttribute({
  params,
  key,
}: {
  params: AgentCallGraphSpan["params"];
  key: string;
}): string {
  const value = attributeOf({ params, key });
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function hasA2aAttribute(params: AgentCallGraphSpan["params"]): boolean {
  if (!params) return false;
  const keys = Object.keys(params);
  return keys.some((key) => key.startsWith("a2a.")) || isRecord(params.a2a);
}

export type A2aClassification = { isA2a: false } | { isA2a: true; mark: A2aSpanMark };

const SERVER_KINDS = new Set([NormalizedSpanKind.SERVER, NormalizedSpanKind.CONSUMER]);
const CLIENT_KINDS = new Set([NormalizedSpanKind.CLIENT, NormalizedSpanKind.PRODUCER]);

function a2aRoleOf({
  name,
  fromName,
  kind,
  spanKind,
}: {
  name: string;
  fromName: string;
  kind: string;
  spanKind: NormalizedSpanKind | null | undefined;
}) {
  const isServerKind = spanKind != null && SERVER_KINDS.has(spanKind);
  const isClientKind = spanKind != null && CLIENT_KINDS.has(spanKind);
  if (fromName === "server" || isServerKind || kind.includes("server")) return "server" as const;
  if (fromName === "client" || isClientKind || kind.includes("client")) return "client" as const;
  if (name.startsWith("invoke_agent")) return "client" as const;
  return "unknown" as const;
}

/** A v1 method name counts only beside A2A attributes or an A2A `rpc.service`. */
function a2aMethodOf({
  params,
  name,
  hasContext,
}: Pick<AgentCallGraphSpan, "params" | "name"> & { hasContext: boolean }): string {
  const declared = textAttribute({ params, key: ATTR_KEYS.A2A_METHOD });
  if (declared) return declared;
  const rpcMethod = textAttribute({ params, key: ATTR_KEYS.RPC_METHOD });
  if (A2A_V0_METHODS.has(rpcMethod)) return rpcMethod;
  if (hasContext && A2A_V1_METHODS.has(rpcMethod)) return rpcMethod;
  return hasContext && A2A_V1_METHODS.has(name) ? name : "";
}

/** Whether a span is an A2A call, by a2a.* attributes, A2A method names or span name. */
export function classifyA2aSpan(
  span: Pick<AgentCallGraphSpan, "spanId" | "name" | "params" | "kind">,
): A2aClassification {
  const { params } = span;
  const name = span.name.trim();
  const match = a2aSpanNameMatch(name);
  const byName = match.matched ? match : null;
  const rpcService = textAttribute({ params, key: ATTR_KEYS.RPC_SERVICE });
  const hasAttributes = hasA2aAttribute(params);
  const hasContext = hasAttributes || /(?:^|\.)A2AService$/i.test(rpcService);
  const method = a2aMethodOf({ params, name, hasContext }) || byName?.method || "";
  if (!hasAttributes && method === "") return { isA2a: false };

  const kind = textAttribute({ params, key: ATTR_KEYS.SPAN_KIND }).toLowerCase();
  return {
    isA2a: true,
    mark: {
      spanId: span.spanId,
      role: a2aRoleOf({ name, fromName: byName?.role ?? "", kind, spanKind: span.kind }),
      method: method || null,
      contextId: textAttribute({ params, key: ATTR_KEYS.A2A_CONTEXT_ID }) || null,
      taskId: textAttribute({ params, key: ATTR_KEYS.A2A_TASK_ID }) || null,
      taskState: textAttribute({ params, key: ATTR_KEYS.A2A_TASK_STATE }) || null,
    },
  };
}

/** Attributes an A2A client span may carry the callee's Agent Card name in. */
const A2A_CALLEE_KEYS = [
  ATTR_KEYS.A2A_AGENT_NAME,
  ATTR_KEYS.A2A_AGENT_CARD_NAME,
  ATTR_KEYS.A2A_AGENT_CARD_NAME_SNAKE,
];

/** The callee an A2A client span names, from its card attributes or `invoke_agent <name>`. */
function calleeOf(span: AgentCallGraphSpan, a2a: A2aClassification): string {
  if (!a2a.isA2a || a2a.mark.role !== "client") return "";
  for (const key of A2A_CALLEE_KEYS) {
    const value = textAttribute({ params: span.params, key });
    if (value) return value;
  }
  return /^invoke_agent\s+(.+)$/.exec(span.name.trim())?.[1]?.trim() ?? "";
}

/** The agent a span names of its own: `gen_ai.agent.name`, else `gen_ai.agent.id`. */
export function ownAgentNameOf(span: Pick<AgentCallGraphSpan, "params">): string {
  const name = textAttribute({ params: span.params, key: ATTR_KEYS.GEN_AI_AGENT_NAME });
  return name || textAttribute({ params: span.params, key: ATTR_KEYS.GEN_AI_AGENT_ID });
}

/** The span tree's agent marks, by the same reading as the call graph. */
export function spanTreeAgentMarksOf({
  name,
  attributes,
  kind,
}: {
  name: string;
  attributes: Record<string, string>;
  kind?: NormalizedSpanKind | null;
}): { agentName: string | null; isA2aCall: boolean } {
  const span = { spanId: "", name, params: attributes, kind };
  return { agentName: ownAgentNameOf(span) || null, isA2aCall: classifyA2aSpan(span).isA2a };
}

/** What one span says about agents: an A2A client's callee wins over its own name. */
type SpanFacts = { a2a: A2aClassification; callee: string; ownName: string };

function factsOf(span: AgentCallGraphSpan): SpanFacts {
  const a2a = classifyA2aSpan(span);
  return { a2a, callee: calleeOf(span, a2a), ownName: ownAgentNameOf(span) };
}

function serviceOwnerOf(service: string | null, source: string): Owner {
  return service
    ? { id: `service:${service}`, label: service, kind: "service", source, named: "none" }
    : { id: "unknown", label: "Unknown", kind: "unknown", source, named: "none" };
}

/** Agents share one node by name; a service node is told apart per entry for the fold. */
const ownerKeyOf = (owner: Owner): string =>
  owner.kind === "agent" ? owner.id : `${owner.id}\u0000${owner.source}`;

type Graph = {
  byId: Map<string, AgentCallGraphSpan>;
  facts: Map<string, SpanFacts>;
  serviceOf: (spanId: string) => string | null;
};

/** Folds the spans of one trace into agents and the calls between them. */
export function buildAgentCallGraph({
  spans,
  resources,
}: {
  spans: readonly AgentCallGraphSpan[];
  resources: AgentCallGraphResources;
}): AgentCallGraph {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const serviceBySpan = new Map(
    resources.spans.map((row) => [row.spanId, row.resourceAttributes["service.name"] ?? null]),
  );
  const defaultService = resources.resourceAttributes["service.name"] ?? null;
  const serviceOf = (spanId: string) => serviceBySpan.get(spanId) ?? defaultService;
  const facts = new Map(spans.map((span) => [span.spanId, factsOf(span)]));
  const graph: Graph = { byId, facts, serviceOf };

  const owners = resolveOwners({ spans, graph });
  const aliases = calleeAliasesOf({ spans, graph, owners });
  const aliased = (owner: Owner) => aliases.get(owner.id) ?? owner;
  const ownerOf = (span: AgentCallGraphSpan) => aliased(ownerFrom(owners, span));
  const folded = foldUnnamedServiceOwners({ spans, graph, ownerOf });
  const ownerAfterFold = (span: AgentCallGraphSpan) => {
    const owner = ownerOf(span);
    return folded.get(ownerKeyOf(owner)) ?? owner;
  };

  const nodes = new Map<string, AgentCallGraphNode>();
  const edges = new Map<string, AgentCallGraphEdge>();
  const a2aSpans: A2aSpanMark[] = [];

  for (const span of spans) {
    const owner = ownerAfterFold(span);
    addSpanToNode({
      nodes,
      owner,
      span,
      hasParent: !span.parentSpanId || byId.has(span.parentSpanId),
    });
    const a2a = facts.get(span.spanId)?.a2a ?? { isA2a: false };
    if (a2a.isA2a) a2aSpans.push(a2a.mark);
    const parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
    if (parent) {
      const above = facts.get(parent.spanId)?.a2a;
      const timed = above?.isA2a && above.mark.role === "client" ? parent : span;
      const isCall = a2a.isA2a || timed !== span;
      addCall({ edges, from: ownerAfterFold(parent), to: owner, span, timed, isA2a: isCall });
    }
  }

  const rootSpan = spans.find((span) => !span.parentSpanId);
  const rootId = rootSpan ? ownerAfterFold(rootSpan).id : undefined;
  const ordered = [...nodes.values()].toSorted(
    (a, b) => Number(b.id === rootId) - Number(a.id === rootId),
  );
  return { nodes: ordered, edges: [...edges.values()].toSorted(byErrorsThenCalls), a2aSpans };
}

/** Edges with errors first, then the busiest. */
const byErrorsThenCalls = (a: AgentCallGraphEdge, b: AgentCallGraphEdge): number =>
  Number(b.errorCount > 0) - Number(a.errorCount > 0) || b.callCount - a.callCount;

function ownerFrom(owners: Map<string, Owner>, span: AgentCallGraphSpan): Owner {
  return owners.get(span.spanId) ?? serviceOwnerOf(null, span.spanId);
}

/**
 * A callee named on an A2A client takes the name the remote agent gives itself,
 * when the first named span under the client is its server span or runs in another
 * service; an Agent Card name and a `gen_ai.agent.name` then stay one node.
 */
function calleeAliasesOf({
  spans,
  graph,
  owners,
}: {
  spans: readonly AgentCallGraphSpan[];
  graph: Graph;
  owners: Map<string, Owner>;
}): Map<string, Owner> {
  const aliases = new Map<string, Owner>();
  for (const span of spans) {
    const owner = owners.get(span.spanId);
    const parent = span.parentSpanId ? graph.byId.get(span.parentSpanId) : undefined;
    if (!owner || owner.named !== "self" || !parent) continue;
    const above = owners.get(parent.spanId);
    if (!above || above.named !== "callee" || above.id === owner.id || aliases.has(above.id)) {
      continue;
    }
    const a2a = graph.facts.get(span.spanId)?.a2a;
    const isServer = a2a?.isA2a === true && a2a.mark.role === "server";
    if (isServer || graph.serviceOf(span.spanId) !== graph.serviceOf(above.source)) {
      aliases.set(above.id, owner);
    }
  }
  return aliases;
}

/**
 * An unnamed service entry whose same-service children name exactly one agent of
 * their own is that agent; an A2A callee never folds its caller in. Each entry
 * into a service folds on its own, so a plain call into it keeps its node.
 */
function foldUnnamedServiceOwners({
  spans,
  graph,
  ownerOf,
}: {
  spans: readonly AgentCallGraphSpan[];
  graph: Graph;
  ownerOf: (span: AgentCallGraphSpan) => Owner;
}): Map<string, Owner> {
  const candidates = new Map<string, Map<string, Owner>>();
  for (const span of spans) {
    const parent = span.parentSpanId ? graph.byId.get(span.parentSpanId) : undefined;
    if (!parent || graph.serviceOf(parent.spanId) !== graph.serviceOf(span.spanId)) continue;
    if (graph.facts.get(span.spanId)?.callee) continue;
    const [from, to] = [ownerOf(parent), ownerOf(span)];
    if (from.kind === "agent" || to.kind !== "agent") continue;
    const key = ownerKeyOf(from);
    const agents = candidates.get(key) ?? new Map<string, Owner>();
    agents.set(to.id, to);
    candidates.set(key, agents);
  }
  const folded = new Map<string, Owner>();
  for (const [key, agents] of candidates) {
    const [only] = agents.values();
    if (agents.size === 1 && only) folded.set(key, only);
  }
  return folded;
}

function addSpanToNode({
  nodes,
  owner,
  span,
  hasParent,
}: {
  nodes: Map<string, AgentCallGraphNode>;
  owner: Owner;
  span: AgentCallGraphSpan;
  hasParent: boolean;
}): void {
  const node = nodes.get(owner.id) ?? {
    id: owner.id,
    label: owner.label,
    kind: owner.kind,
    spanCount: 0,
    llmSpanCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    cost: null,
    hasMissingParent: false,
  };
  node.spanCount += 1;
  if (!hasParent) node.hasMissingParent = true;
  nodes.set(owner.id, node);
  if (span.type !== "llm") return;
  node.llmSpanCount += 1;
  node.promptTokens += finiteOrZero(span.metrics?.promptTokens);
  node.completionTokens += finiteOrZero(span.metrics?.completionTokens);
  const cost = span.metrics?.cost;
  if (typeof cost === "number" && Number.isFinite(cost)) node.cost = (node.cost ?? 0) + cost;
}

const finiteOrZero = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Counts one call where the agent changes between a parent span and its child.
 * `timed` is the A2A client span when the caller has one, so latency is client side.
 */
function addCall({
  edges,
  from,
  to,
  span,
  timed,
  isA2a,
}: {
  edges: Map<string, AgentCallGraphEdge>;
  from: Owner;
  to: Owner;
  span: AgentCallGraphSpan;
  timed: AgentCallGraphSpan;
  isA2a: boolean;
}): void {
  if (from.id === to.id) return;
  const key = `${from.id}\u0000${to.id}`;
  const edge = edges.get(key) ?? {
    from: from.id,
    to: to.id,
    callCount: 0,
    errorCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    a2a: false,
    firstSpanId: span.spanId,
  };
  // A span still open has no end time, so its duration can come out negative.
  const durationMs = Math.max(0, finiteOrZero(timed.durationMs));
  edge.callCount += 1;
  if (span.status === "error" || timed.status === "error") edge.errorCount += 1;
  edge.totalDurationMs += durationMs;
  edge.maxDurationMs = Math.max(edge.maxDurationMs, durationMs);
  edge.a2a = edge.a2a || isA2a;
  edges.set(key, edge);
}

/** One step up the parent chain: a settled value, or the parent to derive it from. */
type UpStep<T> = { value: T } | { parent: AgentCallGraphSpan };

/** Resolves a value per span from its ancestors without recursion; cycles end the walk. */
function resolveUp<T>({
  span,
  cache,
  step,
}: {
  span: AgentCallGraphSpan;
  cache: Map<string, T>;
  step: (span: AgentCallGraphSpan, onChain: ReadonlySet<string>) => UpStep<T>;
}): T {
  const chain: AgentCallGraphSpan[] = [];
  const onChain = new Set<string>();
  let current = span;
  let value = cache.get(current.spanId);
  while (value === undefined) {
    chain.push(current);
    onChain.add(current.spanId);
    const next = step(current, onChain);
    if ("value" in next) {
      value = next.value;
      cache.set(current.spanId, value);
      chain.pop();
      break;
    }
    current = next.parent;
    value = cache.get(current.spanId);
  }
  for (const pending of chain) cache.set(pending.spanId, value);
  return value;
}

const parentOf = (graph: Graph, span: AgentCallGraphSpan) =>
  span.parentSpanId ? graph.byId.get(span.parentSpanId) : undefined;

/** Whether an A2A client above the span, within its own service, named the callee. */
function calleeStep(graph: Graph) {
  return (span: AgentCallGraphSpan, onChain: ReadonlySet<string>): UpStep<boolean> => {
    const facts = graph.facts.get(span.spanId);
    if (facts?.callee) return { value: true };
    if (facts?.ownName) return { value: false };
    const parent = parentOf(graph, span);
    if (!parent || onChain.has(parent.spanId)) return { value: false };
    const sameService = graph.serviceOf(parent.spanId) === graph.serviceOf(span.spanId);
    return sameService ? { parent } : { value: false };
  };
}

function agentOwnerOf(span: AgentCallGraphSpan, facts: SpanFacts, label: string): Owner {
  const named = facts.callee ? "callee" : "self";
  return { id: `agent:${label}`, label, kind: "agent", source: span.spanId, named };
}

/**
 * A span's owner: its own agent; a node for a changed service unless an A2A
 * client named the callee above it in the caller's service; else the parent's.
 */
function ownerStep(graph: Graph, namesCalleeAbove: (span: AgentCallGraphSpan) => boolean) {
  return (span: AgentCallGraphSpan, onChain: ReadonlySet<string>): UpStep<Owner> => {
    const facts = graph.facts.get(span.spanId);
    const label = facts?.callee || facts?.ownName;
    if (facts && label) return { value: agentOwnerOf(span, facts, label) };
    const service = graph.serviceOf(span.spanId);
    const parent = parentOf(graph, span);
    const startsHere =
      !parent ||
      onChain.has(parent.spanId) ||
      (service !== null && service !== graph.serviceOf(parent.spanId) && !namesCalleeAbove(parent));
    return startsHere || !parent ? { value: serviceOwnerOf(service, span.spanId) } : { parent };
  };
}

function resolveOwners({
  spans,
  graph,
}: {
  spans: readonly AgentCallGraphSpan[];
  graph: Graph;
}): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  const callees = new Map<string, boolean>();
  const toCallee = calleeStep(graph);
  const namesCalleeAbove = (span: AgentCallGraphSpan) =>
    resolveUp({ span, cache: callees, step: toCallee });
  const step = ownerStep(graph, namesCalleeAbove);
  for (const span of spans) resolveUp({ span, cache: owners, step });
  return owners;
}

/** Resource rows of the spans the viewer sees; the default comes from the owner's own root. */
export function visibleResourcesOf({
  resources,
  spans,
}: {
  resources: AgentCallGraphResources;
  spans: readonly Pick<AgentCallGraphSpan, "spanId">[];
}): AgentCallGraphResources {
  const visible = new Set(spans.map((span) => span.spanId));
  const rows = resources.spans.filter((row) => visible.has(row.spanId));
  const ownRows = rows.filter((row) => row.ownerProjectId === undefined);
  const root =
    ownRows.find((row) => !row.parentSpanId) ??
    ownRows.find((row) => !row.parentSpanId || !visible.has(row.parentSpanId));
  return { resourceAttributes: root?.resourceAttributes ?? {}, spans: rows };
}
