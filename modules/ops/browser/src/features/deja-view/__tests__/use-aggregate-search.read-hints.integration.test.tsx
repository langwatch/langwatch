/**
 * @vitest-environment jsdom
 * The explorer's search re-reads its result on presence's operator hint, on a tab with no
 * organisation in scope, and on nothing else: no timer.
 * Spec: modules/ops/specs/event-log-search.feature
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

const readSearch = vi.hoisted(() => vi.fn());
const queryOptions = vi.hoisted(() => [] as unknown[]);

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    ops: {
      searchAggregates: {
        useMutation: () => ({
          mutate: (_input: unknown, handlers: { onSuccess: (a: { requestId: string }) => void }) =>
            handlers.onSuccess({ requestId: "ops_search_1" }),
          isPending: false,
          error: null,
        }),
      },
      getAggregateSearch: {
        useQuery: (input: { requestId: string }, options?: { enabled?: boolean }) => {
          queryOptions.push(options);
          return useQuery({
            queryKey: [["ops", "getAggregateSearch"], { input, type: "query" }],
            queryFn: () => readSearch(input),
            enabled: options?.enabled ?? true,
          });
        },
      },
    },
  },
}));

import { useAggregateSearch } from "../behavior/use-aggregate-search.ts";

afterEach(cleanup);

/** presence's stream as the shell's rpc opens it: the test raises each hint by hand. */
class HintRpc extends UiRpc {
  readonly opened: string[] = [];
  private handlers: UiRpcSubscriptionHandlers = {};

  query(): Promise<unknown> {
    throw new Error("the search reads through its own hooks");
  }

  mutate(): Promise<unknown> {
    throw new Error("the search mutates through its own hooks");
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

/** An Ops route: a user is signed in, but no organisation or project is in scope. */
class OpsUiRoute extends UiRoute {
  reading(): UiRouteReadingValues {
    return { params: {}, query: {} };
  }

  setQuery(): void {}
}

function SearchStatus() {
  const search = useAggregateSearch({ query: "trace_1", tenantId: void 0, enabled: true });
  if (search.isSearching) return <p>Searching…</p>;
  return <p>{`${search.results?.length ?? 0} matches`}</p>;
}

function renderSearch(rpc: HintRpc) {
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
        <SearchStatus />
      </UiHostServicesContextProvider>
    </QueryClientProvider>,
  );
}

describe("useAggregateSearch", () => {
  describe("given an operator on an ops tab with no organisation in scope", () => {
    /** @scenario "An ops tab with no organisation in scope refreshes when its search completes" */
    it("reads the result again on the operator hint, ignores another read's hint and sets no timer", async () => {
      readSearch
        .mockResolvedValueOnce({ status: "pending" })
        .mockResolvedValueOnce({ status: "done", results: [{ aggregateId: "trace_1" }] });
      const rpc = new HintRpc();
      renderSearch(rpc);

      expect(await screen.findByText("Searching…")).toBeTruthy();
      expect(rpc.opened).toEqual(["presence.onOperatorReadHints"]);
      expect(readSearch).toHaveBeenCalledTimes(1);

      await act(async () => rpc.raise({ path: "ops.upgrade.getRun" }));
      expect(readSearch).toHaveBeenCalledTimes(1);

      await act(async () => rpc.raise({ path: "ops.getAggregateSearch" }));

      expect(await screen.findByText("1 matches")).toBeTruthy();
      expect(readSearch).toHaveBeenCalledTimes(2);
      expect(readSearch).toHaveBeenLastCalledWith({ requestId: "ops_search_1" });
      for (const options of queryOptions) {
        expect(options ?? {}).not.toHaveProperty("refetchInterval");
      }
    });
  });
});
