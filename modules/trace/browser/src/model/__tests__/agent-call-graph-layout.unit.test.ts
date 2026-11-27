import type { AgentCallGraph } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  a2aSpanIdsOf,
  hasMultipleAgents,
  keepsAgentsTab,
  layerAgentCallGraph,
  mayHaveSeveralAgents,
} from "../agent-call-graph-layout.ts";

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
      firstSpanId: "",
    })),
  };
}

describe("hasMultipleAgents", () => {
  /** @scenario "A one-agent call graph says so" */
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
});

function spanOf(
  spanId: string,
  marks: { agentName?: string | null; isA2aCall?: boolean | null } = {},
) {
  return { spanId, ...marks };
}

describe("mayHaveSeveralAgents", () => {
  /** @scenario "The drawer reads the call graph only for a trace that may hold several agents" */
  it("stays off for one named agent and no A2A call", () => {
    expect(
      mayHaveSeveralAgents({
        spans: [spanOf("a", { agentName: "Planner" }), spanOf("b", { agentName: "Planner" })],
      }),
    ).toBe(false);
    expect(mayHaveSeveralAgents({ spans: [spanOf("a"), spanOf("b", { isA2aCall: false })] })).toBe(
      false,
    );
  });

  /** @scenario "The drawer reads the call graph only for a trace that may hold several agents" */
  it("turns on for two agents in one service or a span marked as an A2A call", () => {
    expect(
      mayHaveSeveralAgents({
        spans: [spanOf("a", { agentName: "Planner" }), spanOf("b", { agentName: "Researcher" })],
      }),
    ).toBe(true);
    expect(mayHaveSeveralAgents({ spans: [spanOf("a"), spanOf("b", { isA2aCall: true })] })).toBe(
      true,
    );
  });
});

describe("keepsAgentsTab", () => {
  /** @scenario "The viz pane keeps the Agents view until the tab's visibility is final" */
  it("keeps a selected Agents tab while unsettled and drops it once settled hidden", () => {
    expect(keepsAgentsTab({ isAgentsSelected: true, showsAgents: false, isSettled: false })).toBe(
      true,
    );
    expect(keepsAgentsTab({ isAgentsSelected: true, showsAgents: false, isSettled: true })).toBe(
      false,
    );
    expect(keepsAgentsTab({ isAgentsSelected: false, showsAgents: false, isSettled: false })).toBe(
      false,
    );
    expect(keepsAgentsTab({ isAgentsSelected: false, showsAgents: true, isSettled: true })).toBe(
      true,
    );
  });
});

describe("a2aSpanIdsOf", () => {
  /** @scenario "The span tree labels only the spans the server marked as A2A calls" */
  it("takes the server's A2A marks and ignores agent invocation names", () => {
    const ids = a2aSpanIdsOf({
      spans: [
        spanOf("client", { isA2aCall: true }),
        spanOf("local", { agentName: "Planner", isA2aCall: false }),
        spanOf("plain"),
      ],
    });
    expect([...ids]).toEqual(["client"]);
  });
});

describe("layerAgentCallGraph with a cycle", () => {
  /** @scenario "A cycle keeps the root caller in the leftmost column" */
  it("keeps the root caller leftmost when the callee calls back", () => {
    const layers = layerAgentCallGraph({
      graph: graphOf(
        ["a", "b"],
        [
          ["a", "b"],
          ["b", "a"],
        ],
      ),
    });
    expect(layers.map((layer) => layer.map((node) => node.id))).toEqual([["a"], ["b"]]);
  });

  /** @scenario "A cycle keeps the root caller in the leftmost column" */
  it("keeps a three-agent loop in call order from the root", () => {
    const layers = layerAgentCallGraph({
      graph: graphOf(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["b", "c"],
          ["c", "a"],
        ],
      ),
    });
    expect(layers.map((layer) => layer.map((node) => node.id))).toEqual([["a"], ["b"], ["c"]]);
  });
});
