// @vitest-environment jsdom
import {
  type UiHostServices,
  UiHostServicesContextProvider,
  UiRpc,
} from "@langwatch/browser-host/capabilities";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUpdateLastLogin } from "../ui-saas-footer";

/** The tRPC boundary's answer while head's api waits on the upgrade. */
function upgradeInProgress(): Error {
  return Object.assign(new Error("upgrade_in_progress"), {
    data: {
      httpStatus: 503,
      error: {
        code: "upgrade_in_progress",
        httpStatus: 503,
        fault: "platform",
        meta: { retryAfterMs: 10_000 },
      },
    },
  });
}

/** Answers upgrade_in_progress `busy` times, then lands the write. */
class UpgradingRpc extends UiRpc {
  readonly calls: string[] = [];
  constructor(private busy: number) {
    super();
  }
  query(): Promise<unknown> {
    return Promise.resolve(null);
  }
  mutate(path: string): Promise<unknown> {
    this.calls.push(path);
    if (this.busy-- > 0) return Promise.reject(upgradeInProgress());
    return Promise.resolve({ ok: true });
  }
  subscribe() {
    return { unsubscribe: () => void 0 };
  }
}

function OnMount() {
  const updateLastLogin = useUpdateLastLogin();
  useEffect(() => updateLastLogin(), [updateLastLogin]);
  return null;
}

function draw({ rpc }: { rpc: UiRpc }) {
  const services: UiHostServices = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => undefined,
    }),
    rpc,
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <UiHostServicesContextProvider value={services}>
        <OnMount />
      </UiHostServicesContextProvider>
    </QueryClientProvider>,
  );
}

// Vitest fails the run on an uncaught rejection, so a thrown write fails this test.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the shell's last-login write", () => {
  describe("when the api answers upgrade_in_progress", () => {
    /** @scenario "The shell's last-login write answered upgrade_in_progress waits instead of throwing" */
    it("raises no uncaught error and lands the write once the api is ready", async () => {
      const rpc = new UpgradingRpc(6);
      draw({ rpc });

      await vi.advanceTimersByTimeAsync(200_000);

      expect(rpc.calls).toHaveLength(7);
      expect(new Set(rpc.calls)).toEqual(new Set(["user.updateLastLogin"]));
    });
  });
});
