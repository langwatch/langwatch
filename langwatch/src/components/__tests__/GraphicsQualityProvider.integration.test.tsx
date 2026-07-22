/**
 * @vitest-environment jsdom
 *
 * Integration tests for GraphicsQualityProvider.
 *
 * Drives the requestAnimationFrame-based probe with a manually-controlled
 * fake queue (explicit timestamps per frame) rather than a synchronous
 * "run immediately" stub — the provider's `tick` re-schedules itself via
 * `requestAnimationFrame(tick)`, so a synchronous stub would recurse
 * infinitely. Full control over simulated elapsed time is also what makes
 * "N frames over a window" deterministic instead of depending on real
 * wall-clock speed.
 *
 * @see specs/components/adaptive-graphics-quality.feature
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsQualityProvider } from "../GraphicsQualityProvider";
import { useGraphicsQuality } from "~/hooks/useGraphicsQuality";

let prefersReducedMotion = false;
vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: () => prefersReducedMotion,
}));

let pendingCallback: FrameRequestCallback | null = null;
let rafCallCount = 0;

function fireFrame(time: number) {
  const cb = pendingCallback;
  pendingCallback = null;
  act(() => {
    cb?.(time);
  });
}

/**
 * Simulates one sample window: a start frame at `startAt`, then `frames`
 * more frames evenly spaced across `windowMs` — the last of which lands
 * exactly on the window boundary, closing it. `frames` over `windowMs`
 * is the simulated frame rate for this window.
 */
function runWindow({
  startAt,
  windowMs,
  frames,
}: {
  startAt: number;
  windowMs: number;
  frames: number;
}) {
  fireFrame(startAt);
  for (let i = 1; i <= frames; i++) {
    fireFrame(startAt + (windowMs / frames) * i);
  }
}

function Consumer() {
  const { reducedGraphics } = useGraphicsQuality();
  return <div data-testid="consumer">{String(reducedGraphics)}</div>;
}

describe("<GraphicsQualityProvider/>", () => {
  beforeEach(() => {
    prefersReducedMotion = false;
    pendingCallback = null;
    rafCallCount = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      pendingCallback = cb;
      return ++rafCallCount;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      pendingCallback = null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-reduced-graphics");
  });

  describe("when the background probe is running", () => {
    /** @scenario "Blur effects turn off when the device can't keep a smooth frame rate" */
    it("marks reduced-graphics mode after a struggling sample window", () => {
      render(
        <GraphicsQualityProvider sampleWindowMs={1000} minFps={50}>
          <Consumer />
        </GraphicsQualityProvider>,
      );

      // 2 frames over 1000ms => ~2fps, well below the 50fps floor.
      runWindow({ startAt: 0, windowMs: 1000, frames: 2 });

      expect(
        document.documentElement.getAttribute("data-reduced-graphics"),
      ).toBe("true");
      expect(screen.getByTestId("consumer").textContent).toBe("true");
    });

    it("does not mark reduced-graphics mode after a smooth sample window", () => {
      render(
        <GraphicsQualityProvider sampleWindowMs={1000} minFps={50}>
          <Consumer />
        </GraphicsQualityProvider>,
      );

      // 90 frames over 1000ms => ~90fps, comfortably above the floor.
      runWindow({ startAt: 0, windowMs: 1000, frames: 90 });

      expect(
        document.documentElement.hasAttribute("data-reduced-graphics"),
      ).toBe(false);
      expect(screen.getByTestId("consumer").textContent).toBe("false");
    });
  });

  describe("when the app is currently in reduced-graphics mode", () => {
    /** @scenario "Blur effects come back once the device recovers" */
    it("leaves reduced-graphics mode once a later window measures a smooth rate", () => {
      render(
        <GraphicsQualityProvider
          sampleWindowMs={1000}
          resampleIntervalMs={1000}
          minFps={50}
        >
          <Consumer />
        </GraphicsQualityProvider>,
      );

      // First window: struggling. Closes at t=1000, next window scheduled
      // to start at t=1000+resampleIntervalMs=2000.
      runWindow({ startAt: 0, windowMs: 1000, frames: 2 });
      expect(screen.getByTestId("consumer").textContent).toBe("true");

      // Second window: smooth. Starts exactly at the scheduled t=2000.
      runWindow({ startAt: 2000, windowMs: 1000, frames: 90 });

      expect(
        document.documentElement.hasAttribute("data-reduced-graphics"),
      ).toBe(false);
      expect(screen.getByTestId("consumer").textContent).toBe("false");
    });
  });

  describe("when the user's system preference is set to reduce motion", () => {
    /** @scenario "A user who prefers reduced motion never triggers the probe" */
    it("never starts the background frame-rate probe", () => {
      prefersReducedMotion = true;

      render(
        <GraphicsQualityProvider>
          <Consumer />
        </GraphicsQualityProvider>,
      );

      expect(pendingCallback).toBeNull();
      expect(screen.getByTestId("consumer").textContent).toBe("false");
    });
  });
});
