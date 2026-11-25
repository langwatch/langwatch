/**
 * When the drawer offers the Agents tab and when it reads the agent call graph.
 * @vitest-environment jsdom
 */
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  isReady: true,
  data: undefined as unknown,
  isError: false,
  options: [] as { enabled: boolean }[],
}));

vi.mock("../use-trace-query-args.ts", () => ({
  useTraceQueryArgs: () => ({
    isReady: queryState.isReady,
    queryArgs: { projectId: "project-1", traceId: "trace-1" },
  }),
}));

vi.mock("../../trace-api.ts", () => ({
  api: {
    traces: {
      agentCallGraph: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => {
          queryState.options.push(options);
          return { data: queryState.data, isError: queryState.isError, refetch: vi.fn() };
        },
      },
    },
  },
}));

const { useAgentsTab } = await import("../use-agents-tab.ts");

const twoAgents = [
  { spanId: "a", agentName: "Planner" },
  { spanId: "b", agentName: "Researcher" },
] as SpanTreeNode[];

beforeEach(() => {
  queryState.isReady = true;
  queryState.data = undefined;
  queryState.isError = false;
  queryState.options = [];
});

afterEach(cleanup);

describe("useAgentsTab", () => {
  /** @scenario "The agent call graph is read only once the Agents tab opens" */
  it("keeps the graph read off until the Agents tab opens", () => {
    const { rerender, result } = renderHook(
      ({ open }: { open: boolean }) =>
        useAgentsTab({ spanTree: twoAgents, isSpanTreeLoading: false, isAgentsTabOpen: open }),
      { initialProps: { open: false } },
    );
    expect(result.current.showsAgents).toBe(true);
    expect(queryState.options.every((options) => !options.enabled)).toBe(true);

    rerender({ open: true });
    expect(queryState.options.at(-1)?.enabled).toBe(true);
  });

  /** @scenario "A shared trace shows no Agents tab" */
  it("hides the tab and reads nothing where the drawer cannot read the trace", () => {
    queryState.isReady = false;
    const { result } = renderHook(() =>
      useAgentsTab({ spanTree: twoAgents, isSpanTreeLoading: false, isAgentsTabOpen: true }),
    );
    expect(result.current.showsAgents).toBe(false);
    expect(result.current.isSettled).toBe(true);
  });

  /** @scenario "The Agents tab stays open while the span tree loads and after a failed read" */
  it("stays unsettled while the span tree loads", () => {
    const { result } = renderHook(() =>
      useAgentsTab({ spanTree: [], isSpanTreeLoading: true, isAgentsTabOpen: true }),
    );
    expect(result.current.isSettled).toBe(false);
  });

  /** @scenario "The Agents tab stays open while the span tree loads and after a failed read" */
  it("settles on a failed read and keeps the tab to show the error", () => {
    queryState.isError = true;
    const { result } = renderHook(() =>
      useAgentsTab({ spanTree: twoAgents, isSpanTreeLoading: false, isAgentsTabOpen: true }),
    );
    expect(result.current.isSettled).toBe(true);
    expect(result.current.showsAgents).toBe(true);
    expect(result.current.isGraphError).toBe(true);
  });

  /** @scenario "The Agents tab stays when the graph finds one agent" */
  it("keeps the tab once the graph loads with one node", () => {
    const a2aOnly = [{ spanId: "a", agentName: null, isA2aCall: true }] as SpanTreeNode[];
    const { result, rerender } = renderHook(() =>
      useAgentsTab({ spanTree: a2aOnly, isSpanTreeLoading: false, isAgentsTabOpen: true }),
    );
    expect(result.current.showsAgents).toBe(true);
    queryState.data = { nodes: [{ id: "service:svc" }], edges: [], a2aSpans: [] };
    rerender();
    expect(result.current.showsAgents).toBe(true);
    expect(result.current.isSettled).toBe(true);
  });
});
