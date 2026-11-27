import { describe, expect, it } from "vitest";

import {
  buildAgentCallGraph,
  classifyA2aSpan,
  spanTreeAgentMarksOf,
} from "../agent-call-graph.rules.ts";
import { mapLegacySpanSummaryToTreeNode } from "../trace-read-mappers.rules.ts";
import { resources, span } from "./agent-call-graph.fixture.ts";

const planner = { "gen_ai.agent.name": "Planner" };
const sendMessage = { "a2a.method": "SendMessage" };

describe("buildAgentCallGraph, when an HTTP span sits between the A2A client and the server", () => {
  /** @scenario "An HTTP span between the A2A client and an unnamed server keeps one remote agent" */
  it("gives the server's spans to the callee the client named", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: planner }),
        span({
          spanId: "client",
          parentSpanId: "root",
          name: "invoke_agent Weather",
          params: sendMessage,
        }),
        span({ spanId: "http", parentSpanId: "client", name: "POST" }),
        span({ spanId: "server", parentSpanId: "http", name: "POST /" }),
        span({
          spanId: "llm",
          parentSpanId: "server",
          type: "llm",
          metrics: { promptTokens: 100, completionTokens: 20, cost: 0.01 },
        }),
      ],
      resources: resources({
        root: "caller-svc",
        client: "caller-svc",
        http: "caller-svc",
        server: "weather-svc",
        llm: "weather-svc",
      }),
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["agent:Planner", "agent:Weather"]);
    expect(graph.nodes[1]).toMatchObject({ llmSpanCount: 1, promptTokens: 100, cost: 0.01 });
    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.a2a])).toEqual([
      ["agent:Planner", "agent:Weather", true],
    ]);
  });

  /** @scenario "An HTTP span between the A2A client and an unnamed server keeps one remote agent" */
  it("still gives a service its own node when only a named agent sits above the HTTP span", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: planner }),
        span({ spanId: "http", parentSpanId: "root", name: "POST" }),
        span({ spanId: "server", parentSpanId: "http", name: "POST /" }),
      ],
      resources: resources({ root: "caller-svc", http: "caller-svc", server: "search-svc" }),
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["agent:Planner", "service:search-svc"]);
  });
});

describe("buildAgentCallGraph, when one service takes a plain call and hosts an agent", () => {
  /** @scenario "A plain call into a service that also hosts an agent keeps its own node" */
  it("folds only the entry that reaches the agent", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: { "gen_ai.agent.name": "Orch" } }),
        span({ spanId: "search", parentSpanId: "root", name: "POST /tools/search" }),
        span({ spanId: "summarise", parentSpanId: "root", name: "POST /summarise" }),
        span({
          spanId: "summariser",
          parentSpanId: "summarise",
          params: { "gen_ai.agent.name": "Summariser" },
        }),
      ],
      resources: resources({
        root: "orch-svc",
        search: "tools-svc",
        summarise: "tools-svc",
        summariser: "tools-svc",
      }),
    });

    const node = (id: string) => graph.nodes.find((candidate) => candidate.id === id);
    expect(node("agent:Summariser")?.spanCount).toBe(2);
    expect(node("service:tools-svc")?.spanCount).toBe(1);
    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.callCount])).toEqual([
      ["agent:Orch", "service:tools-svc", 1],
      ["agent:Orch", "agent:Summariser", 1],
    ]);
  });
});

describe("buildAgentCallGraph, when the Agent Card name differs from the server's agent name", () => {
  /** @scenario "An Agent Card name and the server's own agent name stay one node" */
  it("merges the callee into the agent its server span names", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: planner }),
        span({
          spanId: "client",
          parentSpanId: "root",
          name: "a2a.client SendMessage",
          params: { ...sendMessage, "a2a.agent.card.name": "Weather Card" },
        }),
        span({
          spanId: "server",
          parentSpanId: "client",
          name: "a2a.server SendMessage",
          params: { "gen_ai.agent.name": "weather_agent" },
        }),
        span({ spanId: "llm", parentSpanId: "server", type: "llm" }),
      ],
      resources: resources({
        root: "caller-svc",
        client: "caller-svc",
        server: "weather-svc",
        llm: "weather-svc",
      }),
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["agent:Planner", "agent:weather_agent"]);
    expect(graph.nodes[1]?.spanCount).toBe(3);
    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.a2a])).toEqual([
      ["agent:Planner", "agent:weather_agent", true],
    ]);
  });
});

describe("classifyA2aSpan, for RPC and SDK span shapes", () => {
  /** @scenario "A gRPC call to another service with an A2A method name is not an A2A call" */
  it("needs an A2A rpc.service or a2a attributes before trusting a v1 method name", () => {
    const chat = {
      "rpc.system": "grpc",
      "rpc.service": "chat.v1.Messenger",
      "rpc.method": "SendMessage",
    };
    expect(
      classifyA2aSpan(
        span({ spanId: "chat", name: "chat.v1.Messenger/SendMessage", params: chat }),
      ),
    ).toEqual({ isA2a: false });
    expect(classifyA2aSpan(span({ spanId: "bare", name: "SendMessage" }))).toEqual({
      isA2a: false,
    });
    const a2a = { ...chat, "rpc.service": "a2a.v1.A2AService" };
    expect(
      classifyA2aSpan(span({ spanId: "a2a", name: "a2a.v1.A2AService/SendMessage", params: a2a })),
    ).toMatchObject({ isA2a: true, mark: { method: "SendMessage" } });
  });

  /** @scenario "Stock a2a-sdk span names are marked as A2A calls" */
  it("marks a2a-sdk dotted client and server names with their role and method", () => {
    const client = "a2a.client.transports.jsonrpc.JsonRpcTransport.send_message";
    const legacy = "a2a.client.client.A2AClient.send_message";
    const server =
      "a2a.server.request_handlers.default_request_handler.DefaultRequestHandler.on_message_send";
    expect(classifyA2aSpan(span({ spanId: "c", name: client }))).toMatchObject({
      mark: { role: "client", method: "SendMessage" },
    });
    expect(classifyA2aSpan(span({ spanId: "l", name: legacy }))).toMatchObject({
      mark: { role: "client", method: "SendMessage" },
    });
    expect(classifyA2aSpan(span({ spanId: "s", name: server }))).toMatchObject({
      mark: { role: "server", method: "SendMessage" },
    });
    const queue = "a2a.server.events.event_queue.EventQueue.enqueue_event";
    expect(classifyA2aSpan(span({ spanId: "q", name: queue }))).toEqual({ isA2a: false });
  });
});

describe("buildAgentCallGraph, on malformed input", () => {
  /** @scenario "Open spans, deep chains and bad costs keep the graph sound" */
  it("clamps a negative duration to zero", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: planner }),
        span({
          spanId: "open",
          parentSpanId: "root",
          durationMs: -1_763_000_000_000,
          params: { "gen_ai.agent.name": "Worker" },
        }),
      ],
      resources: resources({}),
    });

    expect(graph.edges[0]).toMatchObject({ totalDurationMs: 0, maxDurationMs: 0 });
  });

  /** @scenario "Open spans, deep chains and bad costs keep the graph sound" */
  it("resolves a 20,000-deep parent chain without overflowing the stack", () => {
    const depth = 20_000;
    const spans = Array.from({ length: depth }, (_, index) =>
      span({
        spanId: `s${index}`,
        parentSpanId: index === 0 ? null : `s${index - 1}`,
        params: index === 0 ? planner : {},
      }),
    );

    const graph = buildAgentCallGraph({ spans, resources: resources({}) });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ id: "agent:Planner", spanCount: depth });
  });

  /** @scenario "Open spans, deep chains and bad costs keep the graph sound" */
  it("leaves NaN and Infinity out of an agent's cost", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: planner }),
        ...[Number.NaN, Number.POSITIVE_INFINITY, 0.5].map((cost, index) =>
          span({
            spanId: `llm${index}`,
            parentSpanId: "root",
            type: "llm",
            metrics: { promptTokens: Number.NaN, completionTokens: 1, cost },
          }),
        ),
      ],
      resources: resources({}),
    });

    expect(graph.nodes[0]).toMatchObject({ cost: 0.5, promptTokens: 0, completionTokens: 3 });
  });
});

describe("spanTreeAgentMarksOf", () => {
  /** @scenario "Span tree nodes carry the agent name and the A2A mark" */
  it("reads the agent name and the A2A mark from the span's attributes", () => {
    expect(
      spanTreeAgentMarksOf({
        name: "invoke_agent Weather",
        attributes: { "gen_ai.agent.id": "planner-1", "a2a.method": "SendMessage" },
      }),
    ).toEqual({ agentName: "planner-1", isA2aCall: true });
    expect(spanTreeAgentMarksOf({ name: "a2a.server SendMessage", attributes: {} })).toEqual({
      agentName: null,
      isA2aCall: true,
    });
    expect(
      spanTreeAgentMarksOf({
        name: "chat.v1.Messenger/SendMessage",
        attributes: { "rpc.method": "SendMessage" },
      }),
    ).toEqual({ agentName: null, isA2aCall: false });
  });

  /** @scenario "Span tree nodes carry the agent name and the A2A mark" */
  it("carries the marks from a summary row onto the tree node", () => {
    const node = mapLegacySpanSummaryToTreeNode({
      spanId: "client",
      parentSpanId: null,
      spanName: "invoke_agent Weather",
      durationMs: 5,
      statusCode: 1,
      spanType: null,
      toolName: null,
      requestId: null,
      querySource: null,
      toolUseId: null,
      model: null,
      cost: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      startTimeMs: 0,
      updatedAtMs: 0,
      agentName: "Planner",
      isA2aCall: true,
    });

    expect(node).toMatchObject({ agentName: "Planner", isA2aCall: true });
  });
});
