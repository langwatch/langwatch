// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFlameViewport } from "../use-flame-viewport";
import type { Viewport } from "../types";

const fullRange: Viewport = { startMs: 0, endMs: 100 };

describe("trace flame viewport", () => {
  it("clamps panning and zooming to the full range and minimum duration", () => {
    const flameAreaRef = { current: null };
    const { result } = renderHook(() => useFlameViewport({ fullRange, flameAreaRef }));

    expect(result.current.viewport).toEqual(fullRange);
    expect(result.current.clampViewport({ startMs: -20, endMs: 40 })).toEqual({
      startMs: 0,
      endMs: 60,
    });
    expect(result.current.clampViewport({ startMs: 90, endMs: 140 })).toEqual({
      startMs: 50,
      endMs: 100,
    });
    expect(result.current.clampViewport({ startMs: 25, endMs: 25 })).toEqual({
      startMs: 25,
      endMs: 25.05,
    });
  });
});
