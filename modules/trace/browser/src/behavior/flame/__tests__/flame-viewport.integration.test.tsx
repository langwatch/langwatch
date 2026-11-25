// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WHEEL_ZOOM_SENSITIVITY } from "../../../model/flame/constants.ts";
import type { Viewport } from "../types.ts";
import { useFlameViewport } from "../use-flame-viewport.ts";

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

describe("trace flame viewport wheel", () => {
  const area = () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 20,
      width: 200,
      height: 20,
      toJSON: () => ({}),
    });
    return el;
  };
  const range: Viewport = { startMs: 0, endMs: 1000 };
  const mountWheelArea = () => {
    const el = area();
    const { result } = renderHook(() =>
      useFlameViewport({ fullRange: range, flameAreaRef: { current: el } }),
    );
    return { el, result };
  };
  const wheel = (el: HTMLElement, init: WheelEventInit) =>
    act(() => {
      el.dispatchEvent(new WheelEvent("wheel", { cancelable: true, ...init }));
    });

  it("zooms toward the cursor, then pans sideways within the full range", () => {
    const { el, result } = mountWheelArea();

    wheel(el, { clientX: 50, deltaY: -200 });
    const zoomed = 1000 * Math.exp(-200 * WHEEL_ZOOM_SENSITIVITY);
    expect(result.current.viewport.startMs).toBeCloseTo(250 - 0.25 * zoomed);
    expect(result.current.viewport.endMs).toBeCloseTo(250 + 0.75 * zoomed);

    const before = result.current.viewport;
    wheel(el, { clientX: 50, deltaX: 40, deltaY: 1 });
    const dt = (40 / 200) * zoomed;
    expect(result.current.viewport.startMs).toBeCloseTo(before.startMs + dt);

    wheel(el, { clientX: 50, shiftKey: true, deltaY: -100000 });
    expect(result.current.viewport.startMs).toBe(0);
  });

  it("never zooms out past the full range", () => {
    const { el, result } = mountWheelArea();

    wheel(el, { clientX: 150, deltaY: 5000 });
    expect(result.current.viewport).toEqual(range);
  });
});
