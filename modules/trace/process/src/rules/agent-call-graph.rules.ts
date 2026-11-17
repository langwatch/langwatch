/**
 * The agent call graph of one trace (specs/agent-call-graph.feature). Each span
 * belongs to one agent; an edge is counted where a child span's agent differs
 * from its parent's. Tokens and cost are summed per agent from its own LLM spans.
 */
import type {
  A2aSpanMark,
  AgentCallGraph,
  AgentCallGraphEdge,
  AgentCallGraphNode,
  SpanDetail,
  TraceResourceInfoDto,
} from "@langwatch/trace-contract";

export type AgentCallGraphSpan = Pick<
  SpanDetail,
  "spanId" | "parentSpanId" | "name" | "type" | "durationMs" | "status" | "metrics" | "params"
>;

export type AgentCallGraphResources = Pick<TraceResourceInfoDto, "resourceAttributes" | "spans">;

/** A2A methods: v1.0 gRPC/JSON-RPC names and the v0.x JSON-RPC names. */
const A2A_METHODS = new Set([
  "SendMessage",
  "SendStreamingMessage",
  "GetTask",
  "ListTasks",
  "CancelTask",
  "SubscribeToTask",
  "GetExtendedAgentCard",
  "CreateTaskPushNotificationConfig",
  "GetTaskPushNotificationConfig",
  "ListTaskPushNotificationConfig",
  "DeleteTaskPushNotificationConfig",
  "message/send",
  "message/stream",
  "tasks/get",
  "tasks/cancel",
  "tasks/resubscribe",
  "tasks/pushNotificationConfig/set",
  "tasks/pushNotificationConfig/get",
  "tasks/pushNotificationConfig/list",
  "tasks/pushNotificationConfig/delete",
  "agent/getAuthenticatedExtendedCard",
]);

type Owner = { id: string; label: string; kind: AgentCallGraphNode["kind"] };

/** Reads a flat dotted key first, then the same path through nested objects. */
export function attributeOf({
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
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
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
  if (keys.some((key) => key.startsWith("a2a."))) return true;
  const nested = params.a2a;
  return nested !== null && typeof nested === "object";
}

export type A2aClassification = { isA2a: false } | { isA2a: true; mark: A2aSpanMark };

function a2aRoleOf({ name, prefix, kind }: { name: string; prefix: string; kind: string }) {
  if (prefix === "server" || kind.includes("server")) return "server" as const;
  if (prefix === "client" || kind.includes("client")) return "client" as const;
  if (name.startsWith("invoke_agent")) return "client" as const;
  return "unknown" as const;
}

function a2aMethodOf({ params, name }: Pick<AgentCallGraphSpan, "params" | "name">): string {
  const declared = textAttribute({ params, key: "a2a.method" });
  if (declared) return declared;
  const rpcMethod = textAttribute({ params, key: "rpc.method" });
  if (A2A_METHODS.has(rpcMethod)) return rpcMethod;
  const fromName = /^a2a\.(?:client|server)\s+(\S+)$/.exec(name)?.[1] ?? "";
  if (fromName) return fromName;
  return A2A_METHODS.has(name) ? name : "";
}

/** Whether a span is an A2A call, by a2a.* attributes, A2A method names or span name. */
export function classifyA2aSpan(span: AgentCallGraphSpan): A2aClassification {
  const { params } = span;
  const name = span.name.trim();
  const method = a2aMethodOf({ params, name });
  if (!hasA2aAttribute(params) && method === "") return { isA2a: false };

  const prefix = /^a2a\.(client|server)\s/.exec(name)?.[1] ?? "";
  const kind = textAttribute({ params, key: "span.kind" }).toLowerCase();
  return {
    isA2a: true,
    mark: {
      spanId: span.spanId,
      role: a2aRoleOf({ name, prefix, kind }),
      method: method || null,
      contextId: textAttribute({ params, key: "a2a.context.id" }) || null,
      taskId: textAttribute({ params, key: "a2a.task.id" }) || null,
      taskState: textAttribute({ params, key: "a2a.task.state" }) || null,
    },
  };
}

/** Attributes an A2A client span may carry the callee's Agent Card name in. */
const A2A_CALLEE_KEYS = ["a2a.agent.name", "a2a.agent.card.name", "a2a.agent_card.name"];

/** The agent a span names: an A2A client's callee first, else `gen_ai.agent.name` or `.id`. */
function agentLabelOf(span: AgentCallGraphSpan): string {
  const callee = calleeOf(span);
  if (callee) return callee;
  const name = textAttribute({ params: span.params, key: "gen_ai.agent.name" });
  return name || textAttribute({ params: span.params, key: "gen_ai.agent.id" });
}

/** The callee an A2A client span names, from its card attributes or `invoke_agent <name>`. */
function calleeOf(span: AgentCallGraphSpan): string {
  const a2a = classifyA2aSpan(span);
  if (!a2a.isA2a || a2a.mark.role !== "client") return "";
  for (const key of A2A_CALLEE_KEYS) {
    const value = textAttribute({ params: span.params, key });
    if (value) return value;
  }
  return /^invoke_agent\s+(.+)$/.exec(span.name.trim())?.[1]?.trim() ?? "";
}

const agentOwner = (label: string): Owner => ({ id: `agent:${label}`, label, kind: "agent" });

function serviceOwnerOf(service: string | null): Owner {
  return service
    ? { id: `service:${service}`, label: service, kind: "service" }
    : { id: "unknown", label: "Unknown", kind: "unknown" };
}

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

  const context: OwnerContext = { byId, serviceOf, owners: new Map() };
  const ownerOf = (span: AgentCallGraphSpan) => ownerOfSpan({ span, context, seen: new Set() });

  const folded = foldUnnamedServiceOwners({ spans, byId, serviceOf, ownerOf });
  const ownerAfterFold = (span: AgentCallGraphSpan) => {
    const owner = ownerOf(span);
    return folded.get(owner.id) ?? owner;
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
    const a2a = classifyA2aSpan(span);
    if (a2a.isA2a) a2aSpans.push(a2a.mark);
    const parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
    if (parent) {
      addCall({ edges, from: ownerAfterFold(parent), to: owner, span, isA2a: a2a.isA2a });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], a2aSpans };
}

/**
 * An unnamed service owner whose same-service children name exactly one agent of
 * their own is that agent; an A2A callee never folds its caller in.
 */
function foldUnnamedServiceOwners({
  spans,
  byId,
  serviceOf,
  ownerOf,
}: {
  spans: readonly AgentCallGraphSpan[];
  byId: Map<string, AgentCallGraphSpan>;
  serviceOf: (spanId: string) => string | null;
  ownerOf: (span: AgentCallGraphSpan) => Owner;
}): Map<string, Owner> {
  const candidates = new Map<string, Map<string, Owner>>();
  for (const span of spans) {
    const parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
    if (!parent || serviceOf(parent.spanId) !== serviceOf(span.spanId)) continue;
    if (calleeOf(span) !== "") continue;
    const [from, to] = [ownerOf(parent), ownerOf(span)];
    if (from.kind === "agent" || to.kind !== "agent") continue;
    const agents = candidates.get(from.id) ?? new Map<string, Owner>();
    agents.set(to.id, to);
    candidates.set(from.id, agents);
  }
  const folded = new Map<string, Owner>();
  for (const [ownerId, agents] of candidates) {
    const [only] = agents.values();
    if (agents.size === 1 && only) folded.set(ownerId, only);
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
  node.promptTokens += span.metrics?.promptTokens ?? 0;
  node.completionTokens += span.metrics?.completionTokens ?? 0;
  const cost = span.metrics?.cost;
  if (typeof cost === "number") node.cost = (node.cost ?? 0) + cost;
}

/** Counts one call where the agent changes between a parent span and its child. */
function addCall({
  edges,
  from,
  to,
  span,
  isA2a,
}: {
  edges: Map<string, AgentCallGraphEdge>;
  from: Owner;
  to: Owner;
  span: AgentCallGraphSpan;
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
    spanIds: [],
  };
  edge.callCount += 1;
  if (span.status === "error") edge.errorCount += 1;
  edge.totalDurationMs += span.durationMs;
  edge.maxDurationMs = Math.max(edge.maxDurationMs, span.durationMs);
  edge.a2a = edge.a2a || isA2a;
  if (edge.spanIds.length === 0) edge.spanIds.push(span.spanId);
  edges.set(key, edge);
}

type OwnerContext = {
  byId: Map<string, AgentCallGraphSpan>;
  serviceOf: (spanId: string) => string | null;
  owners: Map<string, Owner>;
};

/**
 * A span's own agent; a node for a changed service unless an A2A client named it;
 * else the parent's.
 */
function ownerOfSpan({
  span,
  context,
  seen,
}: {
  span: AgentCallGraphSpan;
  context: OwnerContext;
  seen: Set<string>;
}): Owner {
  const cached = context.owners.get(span.spanId);
  if (cached) return cached;
  const owner = resolveOwner({ span, context, seen });
  context.owners.set(span.spanId, owner);
  return owner;
}

function resolveOwner({
  span,
  context,
  seen,
}: {
  span: AgentCallGraphSpan;
  context: OwnerContext;
  seen: Set<string>;
}): Owner {
  const own = agentLabelOf(span);
  if (own) return agentOwner(own);
  const service = context.serviceOf(span.spanId);
  const parent = span.parentSpanId ? context.byId.get(span.parentSpanId) : undefined;
  if (!parent || seen.has(parent.spanId)) return serviceOwnerOf(service);
  seen.add(span.spanId);
  const parentOwner = ownerOfSpan({ span: parent, context, seen });
  const changedService = service !== null && service !== context.serviceOf(parent.spanId);
  const namesCallee = calleeOf(parent) !== "";
  if (changedService && !namesCallee) return serviceOwnerOf(service);
  return parentOwner;
}

/** Resource rows of the spans the viewer sees; the trace default comes from a visible root only. */
export function visibleResourcesOf({
  resources,
  spans,
}: {
  resources: AgentCallGraphResources;
  spans: readonly Pick<AgentCallGraphSpan, "spanId">[];
}): AgentCallGraphResources {
  const visible = new Set(spans.map((span) => span.spanId));
  const rows = resources.spans.filter((row) => visible.has(row.spanId));
  const root = rows.find((row) => !row.parentSpanId || !visible.has(row.parentSpanId));
  return { resourceAttributes: root?.resourceAttributes ?? {}, spans: rows };
}
