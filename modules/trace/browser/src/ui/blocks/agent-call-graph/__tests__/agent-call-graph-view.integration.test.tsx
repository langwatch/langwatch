/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { AgentCallGraph } from "@langwatch/trace-contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCallGraphView } from "../agent-call-graph-view.tsx";

afterEach(cleanup);

function node(id: string, over: Partial<AgentCallGraph["nodes"][number]> = {}) {
  return {
    id,
    label: id,
    kind: "agent" as const,
    spanCount: 2,
    llmSpanCount: 1,
    promptTokens: 10,
    completionTokens: 5,
    cost: 0.0042,
    hasMissingParent: false,
    ...over,
  };
}

const graph: AgentCallGraph = {
  nodes: [node("planner"), node("researcher", { cost: null, hasMissingParent: true })],
  edges: [
    {
      from: "planner",
      to: "researcher",
      callCount: 3,
      errorCount: 1,
      totalDurationMs: 3000,
      maxDurationMs: 1800,
      a2a: true,
      spanIds: ["span-a", "span-b", "span-c"],
    },
  ],
  a2aSpans: [],
};

describe("<AgentCallGraphView/>", () => {
  /** @scenario "Each agent shows its name and cost" */
  it("shows each agent with its name and cost", () => {
    renderWithDesignSystem(<AgentCallGraphView graph={graph} onSelectSpan={vi.fn()} />);
    const nodes = screen.getAllByTestId("agent-call-graph-node");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.textContent).toContain("planner");
    expect(nodes[0]?.textContent).toContain("$");
    expect(nodes[1]?.textContent).toContain("Caller not in this trace");
  });

  /** @scenario "An edge shows calls, errors, latency and the A2A label" */
  it("shows calls, errors, latency and the A2A label on an edge", () => {
    renderWithDesignSystem(<AgentCallGraphView graph={graph} onSelectSpan={vi.fn()} />);
    const edge = screen.getByTestId("agent-call-graph-edge");
    expect(edge.textContent).toContain("3 calls");
    expect(edge.textContent).toContain("1 error");
    expect(edge.textContent).toContain("A2A");
    expect(edge.textContent).toContain("max");
  });

  /** @scenario "Clicking an edge selects its first span" */
  it("selects the first span of an edge when clicked", () => {
    const onSelectSpan = vi.fn();
    renderWithDesignSystem(<AgentCallGraphView graph={graph} onSelectSpan={onSelectSpan} />);
    fireEvent.click(screen.getByTestId("agent-call-graph-edge"));
    expect(onSelectSpan).toHaveBeenCalledWith("span-a");
  });
});
