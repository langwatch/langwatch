/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIsGtagReady } from "../useIsGtagReady";

describe("useIsGtagReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as any).gtag;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given gtag already exists on mount", () => {
    it("returns true immediately", () => {
      (window as any).gtag = vi.fn();

      const { result } = renderHook(() => useIsGtagReady());

      expect(result.current).toBe(true);
    });
  });

  describe("given gtag does not exist on mount", () => {
    it("returns false initially", () => {
      const { result } = renderHook(() => useIsGtagReady());

      expect(result.current).toBe(false);
    });

    it("flips to true once gtag appears", async () => {
      const { result } = renderHook(() => useIsGtagReady());

      expect(result.current).toBe(false);

      (window as any).gtag = vi.fn();
      await act(() => vi.advanceTimersByTimeAsync(250));

      expect(result.current).toBe(true);
    });

    it("stops polling once ready (no dangling interval after unmount)", async () => {
      const { result, unmount } = renderHook(() => useIsGtagReady());
      (window as any).gtag = vi.fn();
      await act(() => vi.advanceTimersByTimeAsync(250));
      expect(result.current).toBe(true);

      unmount();
      await vi.advanceTimersByTimeAsync(10_000);
    });
  });
});
