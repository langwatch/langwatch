/**
 * @vitest-environment jsdom
 *
 * The dodge-release cadence of the floating Langy surfaces: engage the moment
 * a drawer arrives, let go only a beat after it has left.
 * Spec: specs/langy/langy-panel-layout.feature
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLingeringDodge } from "../useLingeringDodge";

const RELEASE_MS = 1000;

function renderDodge(initial: { active: boolean; immediate?: boolean }) {
  return renderHook(
    ({ active, immediate }: { active: boolean; immediate?: boolean }) =>
      useLingeringDodge({
        active,
        releaseDelayMs: RELEASE_MS,
        immediate,
      }),
    { initialProps: initial },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLingeringDodge", () => {
  describe("given a drawer arrives at the right edge", () => {
    it("engages the dodge immediately", () => {
      const { result, rerender } = renderDodge({ active: false });
      expect(result.current).toBe(false);

      rerender({ active: true });
      expect(result.current).toBe(true);
    });
  });

  describe("given the drawer leaves", () => {
    /** @scenario The floating panel returns to the right only after the drawer has left */
    it("holds the dodge for the release delay, then lets go", () => {
      const { result, rerender } = renderDodge({ active: true });

      rerender({ active: false });
      expect(result.current).toBe(true);

      act(() => {
        vi.advanceTimersByTime(RELEASE_MS - 1);
      });
      expect(result.current).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe(false);
    });

    it("re-engages instantly when a drawer returns during the hold", () => {
      const { result, rerender } = renderDodge({ active: true });

      rerender({ active: false });
      act(() => {
        vi.advanceTimersByTime(RELEASE_MS / 2);
      });
      rerender({ active: true });
      expect(result.current).toBe(true);

      // The cancelled release must not fire later and drop an active dodge.
      act(() => {
        vi.advanceTimersByTime(RELEASE_MS * 2);
      });
      expect(result.current).toBe(true);
    });
  });

  describe("given reduced motion", () => {
    it("releases without lingering", () => {
      const { result, rerender } = renderDodge({
        active: true,
        immediate: true,
      });

      rerender({ active: false, immediate: true });
      expect(result.current).toBe(false);
    });
  });
});
