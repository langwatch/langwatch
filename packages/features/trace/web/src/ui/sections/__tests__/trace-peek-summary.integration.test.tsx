// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { render, screen, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { traceApi, type TraceApiMap } from "../trace-api";
import { TracePeekSummary } from "../trace-peek-summary";

/**
 * Proves a feature web package's hooks are testable with no tRPC server and no
 * application: a link that answers from a map is the whole harness.
 *
 * It also owns the assertion that used to live in
 * `platform/app/src/features/traces-v2/components/__tests__/TraceIdPeek.integration.test.tsx`
 * — that the `occurredAtMs` partition hint reaches the header read. That
 * assertion belongs beside the query now that the query is here.
 */

type RecordedCall = { path: string; input: unknown };

function recordingLink(
  calls: RecordedCall[],
  respond: (path: string, input: unknown) => unknown,
): TRPCLink<never> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        calls.push({ path: op.path, input: op.input });
        try {
          observer.next({ result: { type: "data", data: respond(op.path, op.input) } });
          observer.complete();
        } catch (error) {
          observer.error(TRPCClientError.from(error as Error));
        }
        return () => void 0;
      });
}

const header = {
  traceId: "trace-1",
  traceName: "Checkout agent",
  name: "checkout",
  status: "ok",
  durationMs: 1234,
  totalCost: 0,
  totalTokens: 0,
  spanCount: 3,
  models: [],
  input: null,
  output: null,
  error: null,
};

function harness(calls: RecordedCall[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const client = traceApi.createClient({
    links: [recordingLink(calls, () => header)],
  });

  return function Harness({ children }: { children: ReactNode }) {
    return (
      <traceApi.Provider
        client={client as unknown as Parameters<typeof traceApi.Provider>[0]["client"]}
        queryClient={queryClient}
      >
        <QueryClientProvider client={queryClient}>
          <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
        </QueryClientProvider>
      </traceApi.Provider>
    );
  };
}

describe("TracePeekSummary", () => {
  describe("given an occurredAtMs hint", () => {
    it("forwards it to the header read as a partition-pruning hint", async () => {
      const calls: RecordedCall[] = [];

      render(
        <TracePeekSummary projectId="p1" traceId="trace-1" occurredAtMs={1_700_000_000_000} />,
        { wrapper: harness(calls) },
      );

      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      expect(calls[0]).toMatchObject({
        path: "tracesV2.header",
        input: { projectId: "p1", traceId: "trace-1", occurredAtMs: 1_700_000_000_000 },
      });
    });
  });

  describe("given no occurredAtMs hint", () => {
    it("omits it rather than sending undefined", async () => {
      const calls: RecordedCall[] = [];

      render(<TracePeekSummary projectId="p1" traceId="trace-1" />, {
        wrapper: harness(calls),
      });

      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      expect(calls[0]?.input).not.toHaveProperty("occurredAtMs");
    });
  });

  describe("when the header resolves", () => {
    it("reads a truncated preview rather than paying for full content", async () => {
      const calls: RecordedCall[] = [];

      render(<TracePeekSummary projectId="p1" traceId="trace-1" />, {
        wrapper: harness(calls),
      });

      await waitFor(() => expect(screen.getByText("Checkout agent")).toBeTruthy());
      expect(calls[0]?.input).toMatchObject({ full: false });
    });
  });
});
