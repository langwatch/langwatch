/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRollingWindow } from "../useRollingWindow";

describe("useRollingWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "A usage page left open keeps asking for a window that ends now" */
  it("advances the end of the window as time passes", async () => {
    const { result } = renderHook(() => useRollingWindow(30));
    const firstEnd = result.current.toIso;

    await act(async () => {
      vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });

    // Frozen, this would still be asking for yesterday's window, and spend
    // recorded since would look like it had not arrived.
    expect(result.current.toIso).not.toBe(firstEnd);
    expect(new Date(result.current.toIso).getTime()).toBeGreaterThan(
      new Date(firstEnd).getTime(),
    );
  });

  /** @scenario "The window keeps its length as it rolls" */
  it("keeps the window the requested number of days wide", () => {
    const { result } = renderHook(() => useRollingWindow(7));
    const width =
      new Date(result.current.toIso).getTime() -
      new Date(result.current.fromIso).getTime();
    expect(width).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
