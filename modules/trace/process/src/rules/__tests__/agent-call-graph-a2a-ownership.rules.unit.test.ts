import { describe, expect, it } from "vitest";

import { buildAgentCallGraph } from "../agent-call-graph.rules.ts";
import { resources, span } from "./agent-call-graph.fixture.ts";

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
      firstSpanId: "client",
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

describe("buildAgentCallGraph, when an unnamed A2A client under a named agent calls another service", () => {
  /** @scenario "An unnamed A2A client keeps the remote service as its own node" */
  it("gives the remote service its own node and charges its LLM spans to it", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: { "gen_ai.agent.name": "Planner" } }),
        span({
          spanId: "client",
          parentSpanId: "root",
          name: "a2a.client SendMessage",
          params: { "a2a.method": "SendMessage" },
        }),
        span({ spanId: "server", parentSpanId: "client", name: "a2a.server SendMessage" }),
        span({ spanId: "llm", parentSpanId: "server", type: "llm" }),
      ],
      resources: resources({
        root: "caller-svc",
        client: "caller-svc",
        server: "weather-svc",
        llm: "weather-svc",
      }),
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["agent:Planner", "service:weather-svc"]);
    expect(graph.nodes[1]?.llmSpanCount).toBe(1);
    expect(graph.nodes[0]?.llmSpanCount).toBe(0);
    expect(graph.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["agent:Planner", "service:weather-svc"],
    ]);
  });

  /** @scenario "An unnamed A2A client keeps the remote service as its own node" */
  it("treats the client's own gen_ai.agent.name as the caller, not the callee", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: { "gen_ai.agent.name": "Planner" } }),
        span({
          spanId: "client",
          parentSpanId: "root",
          name: "a2a.client SendMessage",
          params: { "a2a.method": "SendMessage", "gen_ai.agent.name": "Planner" },
        }),
        span({ spanId: "server", parentSpanId: "client", name: "a2a.server SendMessage" }),
        span({ spanId: "llm", parentSpanId: "server", type: "llm" }),
      ],
      resources: resources({
        root: "caller-svc",
        client: "caller-svc",
        server: "weather-svc",
        llm: "weather-svc",
      }),
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["agent:Planner", "service:weather-svc"]);
    expect(graph.nodes[1]?.llmSpanCount).toBe(1);
    expect(graph.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["agent:Planner", "service:weather-svc"],
    ]);
  });
});

describe("buildAgentCallGraph, when an A2A client names both itself and its callee", () => {
  /** @scenario "Both sides share one service.name and the client span names the callee" */
  it("gives the callee its own node instead of folding it into the caller", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: { "gen_ai.agent.name": "Planner" } }),
        span({
          spanId: "client",
          parentSpanId: "root",
          name: "a2a.client SendMessage",
          params: {
            "a2a.method": "SendMessage",
            "gen_ai.agent.name": "Planner",
            "a2a.agent.name": "Weather",
          },
        }),
        span({ spanId: "server", parentSpanId: "client", name: "a2a.server SendMessage" }),
        span({ spanId: "llm", parentSpanId: "server", type: "llm" }),
      ],
      resources: resources({
        root: "caller-svc",
        client: "caller-svc",
        server: "weather-svc",
        llm: "weather-svc",
      }),
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["agent:Planner", "agent:Weather"]);
    expect(graph.nodes[1]?.llmSpanCount).toBe(1);
    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.a2a])).toEqual([
      ["agent:Planner", "agent:Weather", true],
    ]);
  });
});
