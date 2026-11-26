import { describe, expect, it } from "vitest";

import {
  type AgentCallGraphResources,
  type AgentCallGraphSpan,
  buildAgentCallGraph,
  classifyA2aSpan,
  visibleResourcesOf,
} from "../agent-call-graph.rules.ts";
import { resources, span } from "./agent-call-graph.fixture.ts";

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
        firstSpanId: "a2a-client",
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

  /** @scenario "A single agent under an unnamed root span stays one node" */
  it("folds an unnamed root in the same service into its only agent", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root" }),
        span({ spanId: "agent", parentSpanId: "root", params: { "gen_ai.agent.name": "planner" } }),
        span({ spanId: "llm", parentSpanId: "agent", type: "llm", metrics: { promptTokens: 3 } }),
      ],
      resources: resources({}),
    });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ id: "agent:planner", spanCount: 3, promptTokens: 3 });
    expect(graph.edges).toEqual([]);
  });

  it("keeps an edge's span ids to the first crossing call", () => {
    const named = { "gen_ai.agent.name": "worker" };
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: { "gen_ai.agent.name": "boss" } }),
        span({ spanId: "w1", parentSpanId: "root", params: named }),
        span({ spanId: "w2", parentSpanId: "root", params: named }),
      ],
      resources: resources({}),
    });

    expect(graph.edges).toMatchObject([{ callCount: 2, firstSpanId: "w1" }]);
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
  /** @scenario "A2A spans are classified with their role, method, context, task and state" */
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

describe("visibleResourcesOf on a braided trace", () => {
  /** @scenario "A braided span never sets the trace default service" */
  it("takes the default service from the owner's own root span", () => {
    const row = (
      spanId: string,
      parentSpanId: string | null,
      service: string,
      ownerProjectId?: string,
    ) => ({
      spanId,
      parentSpanId,
      resourceAttributes: { "service.name": service },
      scope: { name: "", version: "" },
      ...(ownerProjectId ? { ownerProjectId } : {}),
    });
    const braided: AgentCallGraphResources = {
      resourceAttributes: {},
      spans: [
        row("partner", "elsewhere", "partner-service", "project-b"),
        row("root", null, "owner-service"),
      ],
    };
    const visible = visibleResourcesOf({
      resources: braided,
      spans: [{ spanId: "partner" }, { spanId: "root" }],
    });
    expect(visible.resourceAttributes["service.name"]).toBe("owner-service");
  });
});
