/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { TRPCLink } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { traceApi } from "../../../../../behavior/trace-api.ts";
import { useSpanLogs } from "../use-span-logs.ts";

vi.mock("../use-trace-query-args.ts", () => ({
  useTraceQueryArgs: () => ({
    isReady: true,
    queryArgs: { projectId: "project-1", traceId: "trace-1" },
  }),
}));

type Header = { attributes: Record<string, string>; origin: string };

function answeringLink(requested: string[]): TRPCLink<never> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        requested.push(op.path);
        observer.next({ result: { type: "data", data: [] } });
        observer.complete();
        return () => void 0;
      });
}

function renderSpanLogs(header?: Partial<Header>) {
  const requested: string[] = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (header) {
    queryClient.setQueryData(
      getQueryKey(
        traceApi.traces.header,
        { projectId: "project-1", traceId: "trace-1", full: true },
        "query",
      ),
      { attributes: header.attributes ?? {}, origin: header.origin ?? "application" },
    );
  }
  const client = traceApi.createClient({ links: [answeringLink(requested)] });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <traceApi.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </traceApi.Provider>
    );
  }
  const { result } = renderHook(() => useSpanLogs(), { wrapper: Wrapper });
  return { result, requested };
}

describe("useSpanLogs gating", () => {
  describe("when the open trace is an ordinary LLM trace with zero log records", () => {
    it("never fires the traceLogs query", () => {
      const { result, requested } = renderSpanLogs({});

      expect(result.current.fetchStatus).toBe("idle");
      expect(requested).not.toContain("traces.traceLogs");
    });
  });

  describe("when the header counts log records on the trace", () => {
    it("enables the traceLogs query", async () => {
      const { requested } = renderSpanLogs({
        attributes: { "langwatch.reserved.log_record_count": "3" },
      });

      await waitFor(() => expect(requested).toContain("traces.traceLogs"));
    });
  });

  describe("when a coding-agent trace predates the count stamping", () => {
    it("fails open on the origin so the transcript logs still load", async () => {
      const { requested } = renderSpanLogs({ origin: "coding_agent" });

      await waitFor(() => expect(requested).toContain("traces.traceLogs"));
    });
  });

  describe("when the header is still loading", () => {
    it("holds the traceLogs query back rather than firing blind", () => {
      const { result, requested } = renderSpanLogs();

      expect(result.current.fetchStatus).toBe("idle");
      expect(requested).not.toContain("traces.traceLogs");
    });
  });
});
