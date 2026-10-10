/**
 * @vitest-environment jsdom
 * The run view re-reads when presence relays the runner's read hint, and on nothing else: no
 * timer. Spec: modules/ops/specs/upgrades.feature
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
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UpgradeRunDetailView } from "../model/upgrade-view.ts";

const readRun = vi.hoisted(() => vi.fn());
const queryOptions = vi.hoisted(() => [] as unknown[]);

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    ops: {
      upgrade: {
        getRun: {
          useQuery: (input: { id: string }, options?: Record<string, unknown>) => {
            queryOptions.push(options);
            return useQuery({
              queryKey: [["ops", "upgrade", "getRun"], { input, type: "query" }],
              queryFn: () => readRun(input),
            });
          },
        },
      },
    },
  },
}));
vi.mock("../../../behavior/ops-router.ts", () => ({
  useOpsRouter: () => ({ query: { runId: "run_1" }, asPath: "", push: vi.fn() }),
}));

import UpgradeRunScreen from "../ui/sections/upgrade-run.screen.tsx";

afterEach(cleanup);

/** presence's stream as the shell's rpc opens it: the test raises each hint by hand. */
class HintRpc extends UiRpc {
  readonly opened: string[] = [];
  private handlers: UiRpcSubscriptionHandlers = {};

  query(): Promise<unknown> {
    throw new Error("the run view reads through its own hooks");
  }

  mutate(): Promise<unknown> {
    throw new Error("the run view mutates nothing");
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

class InertUiRoute extends UiRoute {
  reading(): UiRouteReadingValues {
    return { params: {}, query: {} };
  }

  setQuery(): void {}
}

function runWith(outcome: string | null): UpgradeRunDetailView {
  return {
    id: "run_1",
    kind: "upgrade",
    release: "3.23.0",
    floor: "3.20.1",
    startedAt: "2026-10-06T10:00:00.000Z",
    finishedAt: outcome === null ? null : "2026-10-06T10:01:00.000Z",
    outcome,
    plan: null,
    report: null,
    phases: [],
    steps: [],
  };
}

function renderRunScreen(rpc: HintRpc) {
  const capabilities = resolveUiHostServices({
    install: {},
    documentTitle: new InertUiDocumentTitle(),
    navigation: new InertUiNavigation(),
    route: new InertUiRoute(),
    rpc,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UiHostServicesContextProvider value={capabilities}>
        <DesignSystemProvider forcedTheme="light">
          <UpgradeRunScreen />
        </DesignSystemProvider>
      </UiHostServicesContextProvider>
    </QueryClientProvider>,
  );
}

describe("UpgradeRunScreen", () => {
  describe("given an operator has a run open while it is running", () => {
    /** @scenario "The upgrade pages re-read when the runner raises a read hint, without a timer" */
    it("reads the run again on the runner's hint and shows its new outcome", async () => {
      readRun.mockResolvedValueOnce(runWith(null)).mockResolvedValueOnce(runWith("succeeded"));
      const rpc = new HintRpc();
      renderRunScreen(rpc);

      expect(await screen.findByText("Running")).toBeTruthy();
      expect(rpc.opened).toEqual(["presence.onUpgradeReadHints"]);
      expect(readRun).toHaveBeenCalledTimes(1);

      await act(async () => rpc.raise({ path: "upgrade.run" }));

      expect(await screen.findByText("Succeeded")).toBeTruthy();
      expect(readRun).toHaveBeenCalledTimes(2);
      for (const options of queryOptions) {
        expect(options).not.toHaveProperty("refetchInterval");
      }
    });
  });
});
