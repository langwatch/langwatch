/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { traceApi } from "../../../../../behavior/trace-api.ts";
import { TraceViewerProvider } from "../../../../elements/explorer/context/trace-viewer-context.tsx";
import { useTraceEvents } from "../use-trace-events.ts";

vi.mock("../use-trace-query-args.ts", () => ({
  useTraceQueryArgs: () => ({
    isReady: true,
    hintReady: true,
    queryArgs: { projectId: "project-1", traceId: "trace-1", occurredAtMs: 1000 },
  }),
}));

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

function renderTraceEvents({ isReadOnly }: { isReadOnly: boolean }) {
  const requested: string[] = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = traceApi.createClient({ links: [answeringLink(requested)] });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <traceApi.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <TraceViewerProvider isReadOnly={isReadOnly}>{children}</TraceViewerProvider>
        </QueryClientProvider>
      </traceApi.Provider>
    );
  }
  renderHook(() => useTraceEvents(), { wrapper: Wrapper });
  return { requested };
}

describe("useTraceEvents on a shared trace page", () => {
  describe("when the page is read-only", () => {
    it("never calls the project-protected traceEvents read", async () => {
      const { requested } = renderTraceEvents({ isReadOnly: true });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(requested).not.toContain("traces.traceEvents");
    });
  });

  describe("when the page is the live drawer", () => {
    it("fetches the events", async () => {
      const { requested } = renderTraceEvents({ isReadOnly: false });

      await waitFor(() => expect(requested).toContain("traces.traceEvents"));
    });
  });
});
