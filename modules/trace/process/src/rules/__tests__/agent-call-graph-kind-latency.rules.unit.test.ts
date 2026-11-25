import { NormalizedSpanKind } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { buildAgentCallGraph, spanTreeAgentMarksOf } from "../agent-call-graph.rules.ts";
import { resources, span } from "./agent-call-graph.fixture.ts";

const llm = (spanId: string, parentSpanId: string, cost: number) =>
  span({ spanId, parentSpanId, type: "llm", metrics: { cost } as never });

describe("buildAgentCallGraph reads the stored span kind", () => {
  /** @scenario "An A2A client span is read by its stored span kind" */
  it("names the callee from a2a.agent.name on a send_message CLIENT span", () => {
    const spans = [
      span({ spanId: "root", params: { "gen_ai.agent.name": "Planner" } }),
      llm("planner-llm", "root", 0.1),
      span({
        spanId: "client",
        parentSpanId: "root",
        name: "send_message",
        kind: NormalizedSpanKind.CLIENT,
        params: { "a2a.method": "message/send", "a2a.agent.name": "Researcher" },
      }),
      span({ spanId: "server", parentSpanId: "client", kind: NormalizedSpanKind.SERVER }),
      llm("callee-llm", "server", 0.5),
    ];
    const ids = Object.fromEntries(spans.map((s) => [s.spanId, "shared-svc"]));
    const graph = buildAgentCallGraph({ spans, resources: resources(ids, "shared-svc") });
    expect(graph.nodes.map((node) => [node.id, node.cost])).toEqual([
      ["agent:Planner", 0.1],
      ["agent:Researcher", 0.5],
    ]);
    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.a2a])).toEqual([
      ["agent:Planner", "agent:Researcher", true],
    ]);
  });

  /** @scenario "An A2A client span is read by its stored span kind" */
  it("marks the span tree's client span from its kind column", () => {
    const marks = spanTreeAgentMarksOf({
      name: "send_message",
      attributes: { "a2a.method": "message/send" },
      kind: NormalizedSpanKind.CLIENT,
    });
    expect(marks.isA2aCall).toBe(true);
  });
});

describe("buildAgentCallGraph edge latency and order", () => {
  /** @scenario "Edge latency is the client side and edges with errors come first" */
  it("times the call on the A2A client span, not the faster server span", () => {
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root" }),
        span({
          spanId: "client",
          parentSpanId: "root",
          name: "send_message",
          kind: NormalizedSpanKind.CLIENT,
          durationMs: 2000,
          status: "error",
          params: { "a2a.method": "message/send" },
        }),
        span({ spanId: "server", parentSpanId: "client", durationMs: 5000 }),
      ],
      resources: resources({ root: "caller-svc", client: "caller-svc", server: "callee-svc" }),
    });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      from: "service:caller-svc",
      to: "service:callee-svc",
      maxDurationMs: 2000,
      errorCount: 1,
      a2a: true,
    });
  });

  /** @scenario "Edge latency is the client side and edges with errors come first" */
  it("lists edges with errors first, then by calls", () => {
    const call = (id: string, agent: string, status: "ok" | "error" = "ok") =>
      span({ spanId: id, parentSpanId: "root", status, params: { "gen_ai.agent.name": agent } });
    const graph = buildAgentCallGraph({
      spans: [
        span({ spanId: "root", params: { "gen_ai.agent.name": "Root" } }),
        call("a1", "Quiet"),
        call("b1", "Busy"),
        call("b2", "Busy"),
        call("b3", "Busy"),
        call("c1", "Broken", "error"),
      ],
      resources: resources({}),
    });
    expect(graph.edges.map((edge) => edge.to)).toEqual([
      "agent:Broken",
      "agent:Busy",
      "agent:Quiet",
    ]);
  });
});
