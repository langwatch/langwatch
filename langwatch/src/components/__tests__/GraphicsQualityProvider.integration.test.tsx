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

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function Consumer() {
  const { reducedGraphics } = useGraphicsQuality();
  return <div data-testid="consumer">{String(reducedGraphics)}</div>;
}

describe("<GraphicsQualityProvider/>", () => {
  beforeEach(() => {
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
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  describe("when the background probe is running", () => {
    /** @scenario "Blur effects turn off when the device can't keep a smooth frame rate" */
    it("marks reduced-graphics mode after consecutive struggling sample windows", () => {
      render(
        <GraphicsQualityProvider
          sampleWindowMs={1000}
          resampleIntervalMs={1000}
          minFps={50}
          consecutiveStrugglingSamples={2}
        >
          <Consumer />
        </GraphicsQualityProvider>,
      );

      // 2 frames over 1000ms => ~2fps, well below the 50fps floor, twice in
      // a row — the confirmation the debounce requires before degrading.
      // The second window starts at 2000 (not 1000): the first window's
      // close pushes the next allowed sample start to
      // close(1000) + resampleIntervalMs(1000).
      runWindow({ startAt: 0, windowMs: 1000, frames: 2 });
      runWindow({ startAt: 2000, windowMs: 1000, frames: 2 });

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

    it("does not mark reduced-graphics mode after a single stray struggling window", () => {
      render(
        <GraphicsQualityProvider
          sampleWindowMs={1000}
          resampleIntervalMs={1000}
          minFps={50}
          consecutiveStrugglingSamples={2}
        >
          <Consumer />
        </GraphicsQualityProvider>,
      );

      // One bad window (e.g. a one-off GC pause) followed by a clean one —
      // the streak resets, so this alone must not flip the fallback on.
      runWindow({ startAt: 0, windowMs: 1000, frames: 2 });
      expect(screen.getByTestId("consumer").textContent).toBe("false");

      runWindow({ startAt: 2000, windowMs: 1000, frames: 90 });
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
          consecutiveStrugglingSamples={2}
        >
          <Consumer />
        </GraphicsQualityProvider>,
      );

      // Two struggling windows in a row to enter reduced-graphics mode.
      runWindow({ startAt: 0, windowMs: 1000, frames: 2 });
      runWindow({ startAt: 2000, windowMs: 1000, frames: 2 });
      expect(screen.getByTestId("consumer").textContent).toBe("true");

      // Recovery only needs one smooth window.
      runWindow({ startAt: 4000, windowMs: 1000, frames: 90 });

      expect(
        document.documentElement.hasAttribute("data-reduced-graphics"),
      ).toBe(false);
      expect(screen.getByTestId("consumer").textContent).toBe("false");
    });
  });

  describe("when the tab is backgrounded during a sample window", () => {
    /** @scenario "A sample window straddling a hidden tab is discarded" */
    it("discards the in-progress window instead of reporting a false struggling rate", () => {
      render(
        <GraphicsQualityProvider
          sampleWindowMs={1000}
          minFps={50}
          consecutiveStrugglingSamples={1}
        >
          <Consumer />
        </GraphicsQualityProvider>,
      );

      // Sample opens while the tab is visible.
      fireFrame(0);

      // Tab gets backgrounded mid-window — the in-progress sample must be
      // discarded immediately, not left to close on a stale start time.
      setDocumentHidden(true);

      // requestAnimationFrame is throttled while hidden; when a callback
      // does eventually fire, its timestamp is still real wall-clock time
      // (here, 30s later). This must not be treated as "0 frames over 30s".
      fireFrame(30_000);
      expect(screen.getByTestId("consumer").textContent).toBe("false");

      // Tab becomes visible again — probe should start a clean window, not
      // conclude the straddled gap was a struggling sample.
      setDocumentHidden(false);
      runWindow({ startAt: 31_000, windowMs: 1000, frames: 90 });

      expect(
        document.documentElement.hasAttribute("data-reduced-graphics"),
      ).toBe(false);
      expect(screen.getByTestId("consumer").textContent).toBe("false");
    });
  });

  describe("when the user's system preference is set to reduce motion", () => {
    /** @scenario "The probe still runs for users who prefer reduced motion" */
    it("still marks reduced-graphics mode on a struggling device", () => {
      // Backdrop-filter is a static effect, not motion — unlike
      // HomePageBanners' animated GPU probe, there is no reduced-motion
      // fallback that already forces the same outcome, so this probe must
      // keep running (and keep helping) regardless of the preference.
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));

      render(
        <GraphicsQualityProvider
          sampleWindowMs={1000}
          resampleIntervalMs={1000}
          minFps={50}
          consecutiveStrugglingSamples={2}
        >
          <Consumer />
        </GraphicsQualityProvider>,
      );

      runWindow({ startAt: 0, windowMs: 1000, frames: 2 });
      runWindow({ startAt: 2000, windowMs: 1000, frames: 2 });

      expect(screen.getByTestId("consumer").textContent).toBe("true");
    });
  });
});
