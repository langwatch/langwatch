/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { TRPCLink } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { traceApi } from "../../../../../behavior/trace-api.ts";
import { NO_TRACE_EVENTS, type TraceListItem } from "../../types/trace.ts";
import { useTraceHeader } from "../use-trace-header.ts";

vi.mock("../use-trace-query-args.ts", () => ({
  useTraceQueryArgs: () => ({
    isLive: false,
    isReady: true,
    queryArgs: { projectId: "project-1", traceId: "trace-1" },
  }),
}));

const listInput = { projectId: "project-1", page: 1, pageSize: 25 };
const headerInput = { projectId: "project-1", traceId: "trace-1", full: true };

const row = (traceId: string): TraceListItem => ({
  traceId,
  timestamp: 1_000,
  name: "checkout",
  serviceName: "svc",
  durationMs: 42,
  totalCost: 0,
  nonBilledCost: 0,
  totalTokens: 7,
  models: ["gpt-5-mini"],
  labels: [],
  status: "ok",
  spanCount: 3,
  sizeBytes: 0,
  input: "hello",
  output: "world",
  origin: "application",
  evaluations: [],
  events: NO_TRACE_EVENTS,
});

function render({ listed }: { listed: string[] }) {
  const requested: string[] = [];
  const answerHeader: { current: (header: unknown) => void } = { current: () => void 0 };
  const link: TRPCLink<never> =
    () =>
    ({ op }) =>
      observable((observer) => {
        requested.push(op.path);
        const answer = (data: unknown) => {
          observer.next({ result: { type: "data", data } });
          observer.complete();
        };
        if (op.path === "traces.header") answerHeader.current = answer;
        else answer(null);
        return () => void 0;
      });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(getQueryKey(traceApi.traces.list, listInput, "query"), {
    items: listed.map(row),
    evaluations: {},
  });
  const client = traceApi.createClient({ links: [link] });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <traceApi.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </traceApi.Provider>
    );
  }
  const { result } = renderHook(() => useTraceHeader(), { wrapper: Wrapper });
  const headerKey = getQueryKey(traceApi.traces.header, headerInput, "query");
  return { result, requested, queryClient, headerKey, answerHeader };
}

describe("useTraceHeader list placeholder", () => {
  describe("given the opened trace is a row of a cached list", () => {
    it("shows the row's fields at once and still fetches the header", async () => {
      const { result, requested } = render({ listed: ["trace-1"] });

      expect(result.current.data).toMatchObject({
        traceId: "trace-1",
        name: "checkout",
        durationMs: 42,
        input: "hello",
      });
      expect(result.current.isPlaceholderData).toBe(true);
      await waitFor(() => expect(requested).toContain("traces.header"));
    });

    it("never writes the row into the header's cache entry", async () => {
      const { requested, queryClient, headerKey } = render({ listed: ["trace-1"] });

      await waitFor(() => expect(requested).toContain("traces.header"));
      expect(queryClient.getQueryData(headerKey)).toBeUndefined();
    });

    it("swaps to the fetched header when it lands", async () => {
      const { result, queryClient, headerKey, answerHeader, requested } = render({
        listed: ["trace-1"],
      });
      await waitFor(() => expect(requested).toContain("traces.header"));

      act(() => answerHeader.current({ traceId: "trace-1", name: "from-the-header" }));

      await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
      expect(result.current.data?.name).toBe("from-the-header");
      expect(queryClient.getQueryData(headerKey)).toMatchObject({ name: "from-the-header" });
    });
  });

  describe("given the opened trace is in no cached list", () => {
    it("has nothing to show until the header lands", async () => {
      const { result, requested } = render({ listed: ["trace-2"] });

      expect(result.current.data).toBeUndefined();
      await waitFor(() => expect(requested).toContain("traces.header"));
    });
  });
});
