import type { AgentCallGraph } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { hasMultipleAgents, layerAgentCallGraph } from "../agent-call-graph-layout.ts";

function graphOf(ids: string[], edges: [string, string][]): AgentCallGraph {
  return {
    nodes: ids.map((id) => ({
      id,
      label: id,
      kind: "agent",
      spanCount: 1,
      llmSpanCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: null,
      hasMissingParent: false,
    })),
    edges: edges.map(([from, to]) => ({
      from,
      to,
      callCount: 1,
      errorCount: 0,
      totalDurationMs: 1,
      maxDurationMs: 1,
      a2a: false,
      spanIds: [],
    })),
    a2aSpans: [],
  };
}

describe("hasMultipleAgents", () => {
  /** @scenario "The Agents tab shows only for a trace with more than one agent" */
  it("hides the graph for a single agent", () => {
    expect(hasMultipleAgents({ graph: graphOf(["a"], []) })).toBe(false);
    expect(hasMultipleAgents({ graph: undefined })).toBe(false);
    expect(hasMultipleAgents({ graph: graphOf(["a", "b"], [["a", "b"]]) })).toBe(true);
  });
});

describe("layerAgentCallGraph", () => {
  it("puts callers left of callees by the longest path", () => {
    const layers = layerAgentCallGraph({
      graph: graphOf(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["b", "c"],
          ["a", "c"],
        ],
      ),
    });
    expect(layers.map((layer) => layer.map((n) => n.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("terminates on a cycle", () => {
    const layers = layerAgentCallGraph({
      graph: graphOf(
        ["a", "b"],
        [
          ["a", "b"],
          ["b", "a"],
        ],
      ),
    });
    expect(layers.flat()).toHaveLength(2);
  });
});
