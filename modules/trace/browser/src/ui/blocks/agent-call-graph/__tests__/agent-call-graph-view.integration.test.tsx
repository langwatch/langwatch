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
      firstSpanId: "span-a",
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

  /** @scenario "Each agent shows its LLM calls and tokens" */
  it("shows each agent's LLM calls with prompt and completion tokens", () => {
    renderWithDesignSystem(<AgentCallGraphView graph={graph} onSelectSpan={vi.fn()} />);
    const tokens = screen.getAllByTestId("agent-call-graph-node-tokens");
    expect(tokens[0]?.textContent).toBe("1 LLM call · 10 prompt / 5 completion tokens");
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

const edge = (to: string, over: Partial<AgentCallGraph["edges"][number]> = {}) => ({
  from: "root",
  to,
  callCount: 1,
  errorCount: 0,
  totalDurationMs: 100,
  maxDurationMs: 100,
  a2a: true,
  firstSpanId: `span-${to}`,
  ...over,
});

describe("AgentCallGraphView with many callees", () => {
  /** @scenario "A wide fan-out keeps the agent nodes visible" */
  it("keeps the node area from shrinking under 55 edges", () => {
    const ids = Array.from({ length: 55 }, (_, index) => `callee-${index}`);
    renderWithDesignSystem(
      <AgentCallGraphView
        graph={{
          nodes: [node("root"), ...ids.map((id) => node(id))],
          edges: ids.map((id) => edge(id)),
          a2aSpans: [],
        }}
        onSelectSpan={() => {}}
      />,
    );
    const area = screen.getByTestId("agent-call-graph-nodes");
    const style = getComputedStyle(area);
    expect(style.flexShrink).toBe("0");
    expect(style.overflow).toBe("auto");
    expect(screen.getAllByTestId("agent-call-graph-node")).toHaveLength(56);
  });

  /** @scenario "Agent nodes show failed calls and the slowest callee" */
  it("colours a callee with failed calls and the slowest clean callee", () => {
    renderWithDesignSystem(
      <AgentCallGraphView
        graph={{
          nodes: [node("root"), node("broken"), node("slow"), node("fast")],
          edges: [
            edge("broken", { errorCount: 2, callCount: 2, totalDurationMs: 400 }),
            edge("slow", { totalDurationMs: 3000, maxDurationMs: 3000 }),
            edge("fast", { totalDurationMs: 50 }),
          ],
          a2aSpans: [],
        }}
        onSelectSpan={() => {}}
      />,
    );
    const statusOf = Object.fromEntries(
      screen
        .getAllByTestId("agent-call-graph-node")
        .map((element) => [element.textContent?.split(/\d/)[0], element.dataset.status]),
    );
    expect(statusOf).toMatchObject({ root: "ok", broken: "error", slow: "slow", fast: "ok" });
    expect(screen.getByText(/2 failed calls/)).toBeTruthy();
  });
});
