/**
 * @vitest-environment jsdom
 * The replay wizard's aggregate count re-reads on presence's operator hint and hands the
 * projections with data on, with no timer. Spec: modules/ops/specs/event-log-search.feature
 */
import {
  resolveUiHostServices,
  UiHostServicesContextProvider,
  UiDocumentTitle,
  UiNavigation,
  UiRoute,
  UiRpc,
  type UiRouteReadingValues,
  type UiRpcSubscription,
  type UiRpcSubscriptionHandlers,
} from "@langwatch/browser-host/capabilities";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const readCount = vi.hoisted(() => vi.fn());
const sentCounts = vi.hoisted(() => [] as unknown[]);
const queryOptions = vi.hoisted(() => [] as unknown[]);

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    ops: {
      discoverAggregates: {
        useMutation: () => ({
          mutate: (input: unknown, handlers: { onSuccess: (a: { requestId: string }) => void }) => {
            sentCounts.push(input);
            handlers.onSuccess({ requestId: "ops_count_1" });
          },
          isPending: false,
          error: null,
        }),
      },
      getAggregateDiscovery: {
        useQuery: (input: { requestId: string }, options?: { enabled?: boolean }) => {
          queryOptions.push(options);
          return useQuery({
            queryKey: [["ops", "getAggregateDiscovery"], { input, type: "query" }],
            queryFn: () => readCount(input),
            enabled: options?.enabled ?? true,
          });
        },
      },
    },
  },
}));

import { useAggregateDiscovery } from "../behavior/use-aggregate-discovery.ts";

afterEach(cleanup);

/** presence's stream as the shell's rpc opens it: the test raises each hint by hand. */
class HintRpc extends UiRpc {
  readonly opened: string[] = [];
  private handlers: UiRpcSubscriptionHandlers = {};

  query(): Promise<unknown> {
    throw new Error("the count reads through its own hooks");
  }

  mutate(): Promise<unknown> {
    throw new Error("the count mutates through its own hooks");
  }

  subscribe(path: string, _input: unknown, handlers: UiRpcSubscriptionHandlers): UiRpcSubscription {
    this.opened.push(path);
    this.handlers = handlers;
    return { unsubscribe: () => {} };
  }

  raise(hint: unknown): void {
    this.handlers.onData?.(hint);
  }
}

class InertUiDocumentTitle extends UiDocumentTitle {
  set(): () => void {
    return () => {};
  }
}

class InertUiNavigation extends UiNavigation {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

/** An Ops route: no organisation or project is in scope. */
class OpsUiRoute extends UiRoute {
  reading(): UiRouteReadingValues {
    return { params: {}, query: {} };
  }

  setQuery(): void {}
}

const discovered = vi.hoisted(() => [] as string[][]);
const onDiscovered = (names: Set<string>) => discovered.push([...names]);

function CountStatus() {
  const count = useAggregateDiscovery({
    projectionNames: ["trace_summary", "span_summary"],
    since: "2025-11-14",
    tenantIds: ["project_1"],
    enabled: true,
    onDiscovered,
  });
  if (count.isDiscovering) return <p>Discovering…</p>;
  return <p>{`${count.discovery?.projections.length ?? 0} projections`}</p>;
}

function renderCount(rpc: HintRpc) {
  const capabilities = resolveUiHostServices({
    install: {},
    documentTitle: new InertUiDocumentTitle(),
    navigation: new InertUiNavigation(),
    route: new OpsUiRoute(),
    rpc,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UiHostServicesContextProvider value={capabilities}>
        <CountStatus />
      </UiHostServicesContextProvider>
    </QueryClientProvider>,
  );
}

describe("useAggregateDiscovery", () => {
  describe("given an operator who changed a replay's tenants or lower bound", () => {
    /** @scenario "The replay wizard selects the projections with data once the count arrives" */
    it("reads the count again on the operator hint and selects the projections with aggregates", async () => {
      readCount.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({
        status: "done",
        discovery: {
          projections: [
            { projectionName: "trace_summary", aggregateCount: 2, tenantBreakdown: [] },
            { projectionName: "span_summary", aggregateCount: 0, tenantBreakdown: [] },
          ],
        },
      });
      const rpc = new HintRpc();
      renderCount(rpc);

      expect(await screen.findByText("Discovering…")).toBeTruthy();
      expect(rpc.opened).toEqual(["presence.onOperatorReadHints"]);
      expect(sentCounts).toEqual([
        {
          projectionNames: ["trace_summary", "span_summary"],
          since: "2025-11-14",
          tenantIds: ["project_1"],
        },
      ]);
      expect(discovered).toEqual([]);

      await act(async () => rpc.raise({ path: "ops.getAggregateSearch" }));
      expect(readCount).toHaveBeenCalledTimes(1);

      await act(async () => rpc.raise({ path: "ops.getAggregateDiscovery" }));

      expect(await screen.findByText("2 projections")).toBeTruthy();
      expect(readCount).toHaveBeenLastCalledWith({ requestId: "ops_count_1" });
      expect(discovered).toEqual([["trace_summary"]]);
      expect(sentCounts).toHaveLength(1);
      for (const options of queryOptions) {
        expect(options ?? {}).not.toHaveProperty("refetchInterval");
      }
    });
  });
});
