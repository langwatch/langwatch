/**
 * @vitest-environment jsdom
 *
 * The restart policy a widget card applies when the bridge tears its frame
 * down: automatic, backed off, capped, forgiven after a healthy minute, and
 * deferred while the tab is hidden.
 *
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRAME_HEALTHY_RESET_MS,
  FRAME_RESTART_BACKOFF_MS,
  useFrameAutoRestart,
} from "../useFrameAutoRestart";

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given a frame the bridge tore down", () => {
  describe("when the tab is visible", () => {
    /** @scenario "A frame that stops responding is restarted automatically" */
    it("restarts on its own after the first short pause", () => {
      const onRestart = vi.fn();
      const { result } = renderHook(() => useFrameAutoRestart({ onRestart }));

      act(() => result.current.noteTornDown());
      expect(result.current.status).toBe("restarting");
      expect(onRestart).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(FRAME_RESTART_BACKOFF_MS[0]));
      expect(onRestart).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("running");
      expect(result.current.attempts).toBe(1);
    });
  });

  describe("when it keeps failing after every restart", () => {
    /** @scenario "Restarts back off and stop after three attempts" */
    it("waits longer each time, then gives up with a manual restart left", () => {
      const onRestart = vi.fn();
      const { result } = renderHook(() => useFrameAutoRestart({ onRestart }));

      for (const [index, delay] of FRAME_RESTART_BACKOFF_MS.entries()) {
        act(() => result.current.noteTornDown());
        act(() => vi.advanceTimersByTime(delay - 1));
        expect(onRestart).toHaveBeenCalledTimes(index);
        act(() => vi.advanceTimersByTime(1));
        expect(onRestart).toHaveBeenCalledTimes(index + 1);
      }

      act(() => result.current.noteTornDown());
      expect(result.current.status).toBe("exhausted");
      act(() => vi.advanceTimersByTime(60_000));
      expect(onRestart).toHaveBeenCalledTimes(FRAME_RESTART_BACKOFF_MS.length);

      act(() => result.current.restartNow());
      expect(onRestart).toHaveBeenCalledTimes(
        FRAME_RESTART_BACKOFF_MS.length + 1,
      );
      expect(result.current.status).toBe("running");
      expect(result.current.attempts).toBe(0);
    });
  });

  describe("when the restarted frame stays healthy for a minute", () => {
    /** @scenario "A frame that stays healthy forgets earlier restarts" */
    it("starts the next failure over from the first short pause", () => {
      const onRestart = vi.fn();
      const { result } = renderHook(() => useFrameAutoRestart({ onRestart }));

      act(() => result.current.noteTornDown());
      act(() => vi.advanceTimersByTime(FRAME_RESTART_BACKOFF_MS[0]));
      act(() => result.current.noteFrameMounted());
      act(() => vi.advanceTimersByTime(FRAME_HEALTHY_RESET_MS));
      expect(result.current.attempts).toBe(0);

      act(() => result.current.noteTornDown());
      act(() => vi.advanceTimersByTime(FRAME_RESTART_BACKOFF_MS[0]));
      expect(onRestart).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the tab is hidden", () => {
    /** @scenario "Automatic restarts wait while the tab is hidden" */
    it("holds the restart until the tab is visible again", () => {
      const onRestart = vi.fn();
      const { result } = renderHook(() => useFrameAutoRestart({ onRestart }));

      act(() => setVisibility("hidden"));
      act(() => result.current.noteTornDown());
      act(() => vi.advanceTimersByTime(FRAME_RESTART_BACKOFF_MS[0] * 10));
      expect(onRestart).not.toHaveBeenCalled();
      expect(result.current.status).toBe("restarting");

      act(() => setVisibility("visible"));
      expect(onRestart).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("running");
    });
  });
});
