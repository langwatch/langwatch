// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDrawerStore } from "../../../../../behavior/drawer.store.ts";
import { previewTraceId } from "../../../../../model/preview-trace-id.ts";
import { NO_TRACE_EVENTS, type TraceListItem } from "../../types/trace.ts";

const seen = vi.hoisted(() => ({ calls: [] as string[], projectId: "project-1" as string | null }));

vi.mock("../../../../../behavior/trace-api.ts", () => {
  const describeValue = (value: unknown): string => {
    if (typeof value === "function")
      return `seed:${(value(undefined) as { traceId: string }).traceId}`;
    if (Array.isArray(value)) return `list:${value.length}`;
    return "value";
  };
  const procedure = (name: string) => ({
    setData: (input: Record<string, unknown>, value: unknown) =>
      seen.calls.push(`set ${name} ${JSON.stringify(input)} ${describeValue(value)}`),
    prefetch: (input: Record<string, unknown>, opts: unknown) =>
      seen.calls.push(`prefetch ${name} ${JSON.stringify(input)} ${JSON.stringify(opts)}`),
  });
  const names = [
    "header",
    "spanTree",
    "spansFull",
    "spanDetail",
    "spanLangwatchSignals",
    "traceEvents",
    "evals",
    "conversationContext",
    "resourceInfo",
  ];
  const traces = Object.fromEntries(names.map((name) => [name, procedure(name)]));
  return { api: { useUtils: () => ({ traces }) } };
});

vi.mock("../../../../../behavior/use-drawer.ts", () => ({
  useDrawer: () => ({
    openDrawer: (name: string, params: unknown) =>
      seen.calls.push(`open ${name} ${JSON.stringify(params)}`),
  }),
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: seen.projectId ? { id: seen.projectId } : undefined,
  }),
}));

vi.mock("../span-tree-paged-query.ts", () => ({
  spanTreeQueryKey: (input: unknown) => ["spanTree", input],
  spanTreeQueryFn: () => () => undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    prefetchQuery: ({ queryKey }: { queryKey: unknown }) =>
      seen.calls.push(`prefetch spanTreePaged ${JSON.stringify(queryKey)}`),
  }),
}));

import { useOpenTraceDrawer } from "../use-open-trace-drawer.ts";

const trace = (overrides: Partial<TraceListItem> = {}): TraceListItem => ({
  traceId: "trace-1",
  timestamp: 1_000,
  name: "trace",
  serviceName: "svc",
  durationMs: 1,
  totalCost: 0,
  nonBilledCost: 0,
  totalTokens: 0,
  models: [],
  labels: [],
  status: "ok",
  spanCount: 4,
  sizeBytes: 0,
  input: null,
  output: null,
  origin: "application",
  evaluations: [],
  events: NO_TRACE_EVENTS,
  ...overrides,
});

function open(item: TraceListItem) {
  const { result } = renderHook(() => useOpenTraceDrawer());
  result.current(item);
  return seen.calls;
}

describe("useOpenTraceDrawer", () => {
  beforeEach(() => {
    seen.calls = [];
    seen.projectId = "project-1";
    useDrawerStore.getState().setVizTabTransient("flame");
  });

  it("seeds the header from the row, prefetches the heavy reads, then opens the drawer", () => {
    expect(open(trace())).toMatchSnapshot();
    expect(useDrawerStore.getState().vizTab).toBe("flame");
  });

  it("only opens the drawer when no project is selected", () => {
    seen.projectId = null;
    expect(open(trace())).toEqual(['open traceV2Details {"traceId":"trace-1","t":"1000"}']);
  });

  it("seeds every read of a preview trace, prefetches nothing, and opens on the waterfall", () => {
    const calls = open(trace({ traceId: previewTraceId("sample"), conversationId: "conv-1" }));
    expect(calls.filter((call) => call.startsWith("prefetch"))).toEqual([]);
    expect(calls).toMatchSnapshot();
    expect(useDrawerStore.getState().vizTab).toBe("waterfall");
  });
});
