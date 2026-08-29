// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MIN_QUERY_LENGTH, useTraceSearchIndex, type TraceSearchItem } from "../index";

const traces: TraceSearchItem[] = [
  {
    traceId: "trace-1",
    name: "Support request",
    serviceName: "gateway",
    input: "How do I reset my password?",
    output: "Use the reset link.",
    models: ["gpt-4.1"],
    evaluations: [{ evaluatorName: "Helpful", label: "pass" }],
    events: { groups: [{ name: "ticket.created" }] },
  },
  {
    traceId: "trace-2",
    name: "Checkout",
    serviceName: "payments",
    input: "Cart total",
    output: "€12",
    error: "payment timeout",
    models: ["claude-sonnet"],
    evaluations: [],
    events: { groups: [] },
  },
];

describe("trace find search index", () => {
  it("requires the existing minimum query length and searches visible trace fields", () => {
    const { result, rerender } = renderHook(({ query }) => useTraceSearchIndex({ traces, query }), {
      initialProps: { query: "p" },
    });

    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(result.current).toEqual([]);

    rerender({ query: "TICKET" });
    expect(result.current).toEqual(["trace-1"]);

    rerender({ query: "TIMEOUT" });
    expect(result.current).toEqual(["trace-2"]);
  });

  it("invalidates the per-row cache when the loaded row collection changes", () => {
    const { result, rerender } = renderHook(
      ({ rows, query }) => useTraceSearchIndex({ traces: rows, query }),
      { initialProps: { rows: traces, query: "new" } },
    );

    expect(result.current).toEqual([]);

    const updatedRows = traces.map((trace) =>
      trace.traceId === "trace-1" ? { ...trace, name: "New support request" } : trace,
    );
    rerender({ rows: updatedRows, query: "new" });

    expect(result.current).toEqual(["trace-1"]);
  });
});
