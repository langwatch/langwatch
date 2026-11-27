import type { AgentCallGraphResources, AgentCallGraphSpan } from "../agent-call-graph.rules.ts";

export function span(
  overrides: Partial<AgentCallGraphSpan> & { spanId: string },
): AgentCallGraphSpan {
  return {
    parentSpanId: null,
    name: overrides.spanId,
    type: "span",
    durationMs: 10,
    status: "ok",
    metrics: null,
    params: {},
    ...overrides,
  };
}

export function resources(
  services: Record<string, string>,
  root = "caller-svc",
): AgentCallGraphResources {
  return {
    resourceAttributes: { "service.name": root },
    spans: Object.entries(services).map(([spanId, service]) => ({
      spanId,
      parentSpanId: null,
      resourceAttributes: { "service.name": service },
      scope: { name: "test", version: null },
    })),
  };
}
