import { describe, expect, it } from "vitest";

import {
  type AgentCallGraphResources,
  type AgentCallGraphSpan,
  classifyA2aSpan,
  buildAgentCallGraph,
  visibleResourcesOf,
} from "../agent-call-graph.rules.ts";

function span(overrides: Partial<AgentCallGraphSpan> & { spanId: string }): AgentCallGraphSpan {
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

function resources(services: Record<string, string>, root = "caller-svc"): AgentCallGraphResources {
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

const twoAgentTrace: AgentCallGraphSpan[] = [
  span({ spanId: "root", params: { "gen_ai.agent.name": "Planner" } }),
  span({
    spanId: "plan-llm",
    parentSpanId: "root",
    type: "llm",
    metrics: { promptTokens: 100, completionTokens: 20, cost: 0.01 },
  }),
  span({
    spanId: "a2a-client",
    parentSpanId: "root",
    name: "invoke_agent Weather Agent",
    durationMs: 250,
    status: "error",
    params: {
      "gen_ai.agent.name": "Weather Agent",
      "gen_ai.operation.name": "invoke_agent",
      "a2a.method": "SendMessage",
      "a2a.context.id": "ctx-1",
      "a2a.task.id": "task-1",
      "a2a.task.state": "completed",
    },
  }),
  span({ spanId: "a2a-server", parentSpanId: "a2a-client", name: "a2a.server SendMessage" }),
  span({
    spanId: "weather-llm",
    parentSpanId: "a2a-server",
    type: "llm",
    metrics: { promptTokens: 40, completionTokens: 5, cost: 0.002 },
  }),
];
const twoAgentResources = resources({ "a2a-server": "weather-svc", "weather-llm": "weather-svc" });

describe("buildAgentCallGraph", () => {
  /** @scenario "Two agents across an A2A hop share one call graph" */
  it("builds one A2A edge from the caller to the remote agent", () => {
    const graph = buildAgentCallGraph({ spans: twoAgentTrace, resources: twoAgentResources });

    expect(graph.nodes.map((node) => node.id)).toEqual(["agent:Planner", "agent:Weather Agent"]);
    expect(graph.edges).toEqual([
      {
        from: "agent:Planner",
        to: "agent:Weather Agent",
        callCount: 1,
        errorCount: 1,
        totalDurationMs: 250,
        maxDurationMs: 250,
        a2a: true,
        spanIds: ["a2a-client"],
      },
    ]);
  });

  /** @scenario "Each agent carries its own tokens and cost" */
  it("sums tokens and cost per agent from its own LLM spans", () => {
    const graph = buildAgentCallGraph({ spans: twoAgentTrace, resources: twoAgentResources });
    const [planner, weather] = graph.nodes;

    expect(planner).toMatchObject({ spanCount: 2, llmSpanCount: 1, promptTokens: 100 });
    expect(planner?.cost).toBeCloseTo(0.01);
    expect(weather).toMatchObject({ spanCount: 3, llmSpanCount: 1, completionTokens: 5 });
    expect(weather?.cost).toBeCloseTo(0.002);
  });

  /** @scenario "A single-agent trace has one node and no edges" */
  it("keeps a single-agent trace in one node", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root" }),
        span({ spanId: "llm", parentSpanId: "root", type: "llm", metrics: { promptTokens: 3 } }),
      ],
      resources: resources({}),
    });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({
      id: "service:caller-svc",
      kind: "service",
      spanCount: 2,
      cost: null,
    });
    expect(graph.edges).toEqual([]);
  });

  /** @scenario "A remote span whose parent is missing stays in the graph" */
  it("flags an orphan remote span and invents no edge", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: { "gen_ai.agent.name": "Planner" } }),
        span({ spanId: "orphan", parentSpanId: "never-arrived" }),
      ],
      resources: resources({ orphan: "weather-svc" }),
    });

    expect(graph.nodes.find((node) => node.id === "service:weather-svc")).toMatchObject({
      hasMissingParent: true,
    });
    expect(graph.edges).toEqual([]);
  });

  /** @scenario "A service without an agent name becomes its own node" */
  it("makes a node of a child running in another service", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root" }),
        span({ spanId: "http", parentSpanId: "root", durationMs: 30 }),
        span({ spanId: "remote", parentSpanId: "http", durationMs: 20 }),
      ],
      resources: resources({ remote: "search-svc" }),
    });

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "service:caller-svc",
      "service:search-svc",
    ]);
    expect(graph.edges).toMatchObject([
      { from: "service:caller-svc", to: "service:search-svc", callCount: 1, a2a: false },
    ]);
  });
});

describe("classifyA2aSpan", () => {
  /** @scenario "A2A spans are marked so the span tree can label them" */
  it("marks spans by a2a attributes, JSON-RPC method or span name", () => {
    expect(classifyA2aSpan(twoAgentTrace[2]!)).toEqual({
      isA2a: true,
      mark: {
        spanId: "a2a-client",
        role: "client",
        method: "SendMessage",
        contextId: "ctx-1",
        taskId: "task-1",
        taskState: "completed",
      },
    });
    expect(classifyA2aSpan(twoAgentTrace[3]!)).toMatchObject({
      mark: { role: "server", method: "SendMessage" },
    });
    expect(
      classifyA2aSpan(span({ spanId: "rpc", params: { rpc: { method: "message/send" } } })),
    ).toMatchObject({ mark: { method: "message/send", role: "unknown" } });
    expect(classifyA2aSpan(span({ spanId: "plain", name: "POST /chat" }))).toEqual({
      isA2a: false,
    });
  });

  it("lists every A2A span in the graph", () => {
    const graph = buildAgentCallGraph({ spans: twoAgentTrace, resources: twoAgentResources });

    expect(graph.a2aSpans.map((mark) => mark.spanId)).toEqual(["a2a-client", "a2a-server"]);
  });
});

describe("buildAgentCallGraph, when both sides of an A2A hop share one service.name", () => {
  const sharedService = resources(
    {
      root: "shared-svc",
      call: "shared-svc",
      client: "shared-svc",
      server: "shared-svc",
      llm: "shared-svc",
    },
    "shared-svc",
  );
  const clientParams = { "a2a.method": "SendMessage", "gen_ai.operation.name": "invoke_agent" };

  /** @scenario "Both sides share one service.name and the client span names the callee" */
  it("gives two nodes and one A2A edge when the client span names the callee", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", name: "Scenario Turn" }),
        span({ spanId: "call", parentSpanId: "root", name: "A2AAgent.call" }),
        span({
          spanId: "client",
          parentSpanId: "call",
          name: "invoke_agent ACME Support Agent",
          params: { ...clientParams, "gen_ai.agent.name": "ACME Support Agent" },
        }),
        span({ spanId: "server", parentSpanId: "client", name: "a2a.server SendMessage" }),
        span({ spanId: "llm", parentSpanId: "server", type: "llm" }),
      ],
      resources: sharedService,
    });

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "service:shared-svc",
      "agent:ACME Support Agent",
    ]);
    expect(graph.nodes[1]?.spanCount).toBe(3);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      from: "service:shared-svc",
      to: "agent:ACME Support Agent",
      a2a: true,
      spanIds: ["client"],
    });
  });

  it("takes the callee from an a2a.* card attribute or the invoke_agent span name", () => {
    for (const params of [{ ...clientParams, "a2a.agent.name": "Billing" }, clientParams]) {
      const graph = buildAgentCallGraph({
        spans: [
          span({ spanId: "root" }),
          span({ spanId: "client", parentSpanId: "root", name: "invoke_agent Billing", params }),
          span({ spanId: "server", parentSpanId: "client", name: "a2a.server SendMessage" }),
        ],
        resources: sharedService,
      });
      expect(graph.nodes.map((node) => node.id)).toEqual(["service:shared-svc", "agent:Billing"]);
      expect(graph.edges.map((edge) => edge.a2a)).toEqual([true]);
    }
  });

  it("gives a descendant naming its own agent a node of its own", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root" }),
        span({
          spanId: "client",
          parentSpanId: "root",
          name: "invoke_agent Billing",
          params: clientParams,
        }),
        span({
          spanId: "server",
          parentSpanId: "client",
          params: { "gen_ai.agent.name": "Ledger" },
        }),
      ],
      resources: sharedService,
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "service:shared-svc",
      "agent:Billing",
      "agent:Ledger",
    ]);
  });
});

describe("buildAgentCallGraph, when an unnamed span under a named agent changes service", () => {
  it("keeps the service as its own node with a call edge from the agent", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: { "gen_ai.agent.name": "Planner" } }),
        span({ spanId: "search", parentSpanId: "root", name: "POST /search" }),
      ],
      resources: resources({ root: "caller-svc", search: "search-svc" }),
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["agent:Planner", "service:search-svc"]);
    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.a2a])).toEqual([
      ["agent:Planner", "service:search-svc", false],
    ]);
  });
});

describe("visibleResourcesOf", () => {
  it("drops resource rows of hidden spans and never falls back to a hidden root's service", () => {
    const all: AgentCallGraphResources = {
      resourceAttributes: { "service.name": "hidden-root-svc" },
      spans: [
        {
          spanId: "old-root",
          parentSpanId: null,
          resourceAttributes: { "service.name": "hidden-root-svc" },
          scope: { name: "t", version: null },
        },
        {
          spanId: "child",
          parentSpanId: "old-root",
          resourceAttributes: {},
          scope: { name: "t", version: null },
        },
      ],
    };

    const visible = visibleResourcesOf({ resources: all, spans: [{ spanId: "child" }] });

    expect(visible.spans.map((row) => row.spanId)).toEqual(["child"]);
    expect(visible.resourceAttributes["service.name"]).toBeUndefined();
    const graph = buildAgentCallGraph({
      spans: [span({ spanId: "child", parentSpanId: "old-root" })],
      resources: visible,
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(["unknown"]);
  });
});
