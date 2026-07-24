/**
 * @vitest-environment jsdom
 *
 * The trace-switch overlay must fire only on a genuine A→B switch, hold
 * through the new trace's load plus a short floor (so prefetched/instant
 * switches still flash), and never fire on a same-trace refresh or the
 * first open.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTraceSwitchOverlay } from "../useTraceSwitchOverlay";

describe("useTraceSwitchOverlay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("given the first open of the drawer", () => {
    describe("when the initial trace is already loaded", () => {
      it("does not show the overlay", () => {
        const { result } = renderHook(() =>
          useTraceSwitchOverlay({ traceId: "trace-a", isLoading: false }),
        );
        expect(result.current).toBe(false);
      });
    });
  });

  describe("when the same trace refreshes in place", () => {
    it("never shows the overlay", () => {
      const { result, rerender } = renderHook(
        ({ isLoading }) =>
          useTraceSwitchOverlay({ traceId: "trace-a", isLoading }),
        { initialProps: { isLoading: false } },
      );
      // A live update flips isLoading without changing the traceId.
      rerender({ isLoading: true });
      rerender({ isLoading: false });
      expect(result.current).toBe(false);
    });
  });

  describe("when switching to a different, already-loaded trace", () => {
    it("flashes the overlay for the minimum floor then hides it", () => {
      const { result, rerender } = renderHook(
        ({ traceId }) => useTraceSwitchOverlay({ traceId, isLoading: false }),
        { initialProps: { traceId: "trace-a" } },
      );
      expect(result.current).toBe(false);

      // Switch A → B; B is prefetched so isLoading stays false.
      rerender({ traceId: "trace-b" });
      expect(result.current).toBe(true);

      // Held for the floor, then cleared.
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(result.current).toBe(true);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current).toBe(false);
    });
  });

  describe("when switching to a trace that is still loading", () => {
    it("holds the overlay until the data resolves, then clears after the floor", () => {
      const { result, rerender } = renderHook(
        ({ traceId, isLoading }) =>
          useTraceSwitchOverlay({ traceId, isLoading }),
        { initialProps: { traceId: "trace-a", isLoading: false } },
      );

      rerender({ traceId: "trace-b", isLoading: true });
      expect(result.current).toBe(true);

      // While loading, the floor timer hasn't started — overlay stays up.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current).toBe(true);

      // Data resolves; the floor starts now.
      rerender({ traceId: "trace-b", isLoading: false });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(result.current).toBe(false);
    });
  });
});
