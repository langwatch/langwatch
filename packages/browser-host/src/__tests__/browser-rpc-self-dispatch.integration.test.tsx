// @vitest-environment jsdom
/**
 * A `useQuery` on a tRPC key whose `queryFn` dispatches that same procedure.
 * Spec: specs/ui/by-path-dispatch.feature
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { BrowserUiRpc, type UiRpcTransport } from "../browser-rpc";

const PROCEDURE = "organization.getAll";
const INPUT = { isDemo: false };

function transportAnswering(answer: unknown): UiRpcTransport {
  return {
    query: vi.fn(async () => answer),
    mutation: vi.fn(async () => answer),
    subscription: vi.fn(() => ({ unsubscribe: () => {} })),
  };
}

/** Exactly what the chrome, the org facts and the `?org` reader all do. */
function WorkspaceGraph({ rpc }: { rpc: BrowserUiRpc }) {
  const organizations = useQuery({
    queryKey: trpcQueryKey(PROCEDURE, { input: INPUT, type: "query" }),
    queryFn: () => rpc.query(PROCEDURE, INPUT) as Promise<{ id: string }[]>,
  });

  if (organizations.isLoading) return <span>waiting</span>;
  return <span>{organizations.data?.map((one) => one.id).join(",") ?? "none"}</span>;
}

function withClient(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("given a useQuery whose queryFn dispatches its own key through UiRpc", () => {
  describe("when the page renders", () => {
    /** @scenario "A query that dispatches its own key still settles" */
    it("settles rather than awaiting its own in-flight fetch forever", async () => {
      const queryClient = new QueryClient();
      const rpc = BrowserUiRpc.create({
        transport: transportAnswering([{ id: "local-dev-organization" }]),
        queryClient,
      });

      render(<WorkspaceGraph rpc={rpc} />, { wrapper: withClient(queryClient) });

      // Before the fix this stayed on "waiting" for the life of the document:
      // `fetchQuery` joined the observer's own fetch, so the queryFn awaited
      // the promise it was itself supposed to resolve.
      expect(await screen.findByText("local-dev-organization")).toBeTruthy();
    });
  });
});

describe("given a procedure dispatched by name with nothing else reading it", () => {
  describe("when it has been read", () => {
    /** @scenario "A dispatched procedure lands under the typed hook's key" */
    it("still publishes under the key a typed hook would read", async () => {
      const queryClient = new QueryClient();
      const rpc = BrowserUiRpc.create({
        transport: transportAnswering([{ id: "org_1" }]),
        queryClient,
      });

      await rpc.query(PROCEDURE, INPUT);

      expect(
        queryClient.getQueryData(trpcQueryKey(PROCEDURE, { input: INPUT, type: "query" })),
      ).toEqual([{ id: "org_1" }]);
    });
  });
});
