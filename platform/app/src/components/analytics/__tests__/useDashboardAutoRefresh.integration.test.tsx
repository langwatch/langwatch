/**
 * @vitest-environment jsdom
 *
 * The dashboard's refresh schedule: ticks on the chosen interval while the
 * tab is visible, none while hidden, a catch-up tick on return, and a choice
 * that survives the page.
 *
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DASHBOARD_AUTO_REFRESH_MS,
  DASHBOARD_AUTO_REFRESH_STORAGE_KEY,
  useDashboardAutoRefresh,
} from "../useDashboardAutoRefresh";

const MINUTE = DASHBOARD_AUTO_REFRESH_MS["1m"] as number;

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given auto-refresh is set to every minute", () => {
  describe("when a minute passes with the tab visible", () => {
    /** @scenario "Every chart on the dashboard refreshes on a schedule" */
    it("ticks, moving refreshedAt and calling onTick", () => {
      const onTick = vi.fn();
      const { result } = renderHook(() => useDashboardAutoRefresh({ onTick }));
      expect(result.current.option).toBe("1m");
      expect(result.current.refreshedAt).toBeUndefined();

      act(() => vi.advanceTimersByTime(MINUTE));
      expect(onTick).toHaveBeenCalledTimes(1);
      const first = result.current.refreshedAt;
      expect(first).toBeTypeOf("number");

      act(() => vi.advanceTimersByTime(MINUTE));
      expect(onTick).toHaveBeenCalledTimes(2);
      expect(result.current.refreshedAt).not.toBe(first);
    });
  });

  describe("when the tab is hidden for several minutes", () => {
    /** @scenario "Auto-refresh pauses while the tab is hidden and catches up on return" */
    it("does not tick while hidden and ticks once immediately on return", () => {
      const onTick = vi.fn();
      renderHook(() => useDashboardAutoRefresh({ onTick }));

      act(() => setVisibility("hidden"));
      act(() => vi.advanceTimersByTime(MINUTE * 5));
      expect(onTick).not.toHaveBeenCalled();

      act(() => setVisibility("visible"));
      expect(onTick).toHaveBeenCalledTimes(1);

      act(() => vi.advanceTimersByTime(MINUTE));
      expect(onTick).toHaveBeenCalledTimes(2);
    });

    it("does not tick on return when the tab was hidden only briefly", () => {
      const onTick = vi.fn();
      renderHook(() => useDashboardAutoRefresh({ onTick }));

      act(() => setVisibility("hidden"));
      act(() => vi.advanceTimersByTime(1_000));
      act(() => setVisibility("visible"));
      expect(onTick).not.toHaveBeenCalled();
    });
  });
});

describe("given the member changes the interval", () => {
  describe("when the choice is made and the widget remounts", () => {
    /** @scenario "The auto-refresh choice is remembered" */
    it("remembers the choice across mounts and stops when set to off", () => {
      const onTick = vi.fn();
      const first = renderHook(() => useDashboardAutoRefresh({ onTick }));
      act(() => first.result.current.setOption("5m"));
      expect(
        window.localStorage.getItem(DASHBOARD_AUTO_REFRESH_STORAGE_KEY),
      ).toBe("5m");
      first.unmount();

      const second = renderHook(() => useDashboardAutoRefresh({ onTick }));
      expect(second.result.current.option).toBe("5m");
      act(() => vi.advanceTimersByTime(MINUTE));
      expect(onTick).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(MINUTE * 4));
      expect(onTick).toHaveBeenCalledTimes(1);

      act(() => second.result.current.setOption("off"));
      act(() => vi.advanceTimersByTime(MINUTE * 10));
      expect(onTick).toHaveBeenCalledTimes(1);
    });
  });
});
