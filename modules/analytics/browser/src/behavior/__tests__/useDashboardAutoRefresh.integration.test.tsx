/** @vitest-environment jsdom */

/**
 * The dashboard's refresh schedule: the chosen interval becomes the refetchInterval the reads
 * poll on, refreshedAt moves on each poll after the first, and the choice is persisted.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { clearReaderUiStorage, setUiStorageReader } from "@langwatch/browser-host/storage";
import {
  environmentManager,
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DASHBOARD_AUTO_REFRESH_MS,
  useDashboardAutoRefresh,
} from "../use-dashboard-auto-refresh.ts";

const MINUTE = DASHBOARD_AUTO_REFRESH_MS["1m"] as number;

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function renderAutoRefresh() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useDashboardAutoRefresh(), { wrapper });
  return { ...rendered, client };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Polling needs a client that is not "server" and a focused tab; pin both for jsdom.
  environmentManager.setIsServer(() => false);
  focusManager.setFocused(true);
  window.localStorage.clear();
  setUiStorageReader("reader-1");
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  clearReaderUiStorage();
});

describe("given auto-refresh is set to every minute", () => {
  describe("when a minute passes", () => {
    /** @scenario "Every chart on the dashboard refreshes on a schedule" */
    it("polls on that interval and moves refreshedAt on each poll after the first", async () => {
      const { result, client } = renderAutoRefresh();
      act(() => result.current.setOption("1m"));
      expect(result.current.option).toBe("1m");
      expect(result.current.refetchInterval).toBe(MINUTE);
      await waitFor(() => {
        expect(client.getQueryData(["analytics", "dashboard-refresh-clock"])).toBe(0);
      });
      expect(result.current.refreshedAt).toBeUndefined();

      await advance(MINUTE);
      const first = result.current.refreshedAt;
      expect(first).toBeTypeOf("number");

      await advance(MINUTE);
      expect(result.current.refreshedAt).not.toBe(first);
    });
  });
});

describe("given the member changes the interval", () => {
  describe("when the choice is made and the widget remounts", () => {
    /** @scenario "The auto-refresh choice is remembered" */
    it("remembers the choice across mounts and stops polling when set to off", async () => {
      const first = renderAutoRefresh();
      act(() => first.result.current.setOption("5m"));
      first.unmount();

      const second = renderAutoRefresh();
      expect(second.result.current.option).toBe("5m");
      expect(second.result.current.refetchInterval).toBe(DASHBOARD_AUTO_REFRESH_MS["5m"]);

      act(() => second.result.current.setOption("off"));
      expect(second.result.current.refetchInterval).toBe(false);
      await advance(MINUTE * 10);
      expect(second.result.current.refreshedAt).toBeUndefined();
    });
  });

  describe("when the member signs out", () => {
    it("forgets the choice", () => {
      const first = renderAutoRefresh();
      act(() => first.result.current.setOption("5m"));
      first.unmount();

      act(() => clearReaderUiStorage());

      const second = renderAutoRefresh();
      expect(second.result.current.option).toBe("off");
    });
  });
});
