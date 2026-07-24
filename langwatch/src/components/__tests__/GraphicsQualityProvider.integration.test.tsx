/**
 * @vitest-environment jsdom
 *
 * Integration tests for GraphicsQualityProvider.
 *
 * Drives the requestAnimationFrame-based probe with a manually-controlled
 * fake queue (explicit timestamps per frame) rather than a synchronous
 * "run immediately" stub — the provider's `measureFrame` re-schedules
 * itself via `requestAnimationFrame(measureFrame)` during an active window,
 * so a synchronous stub would recurse infinitely. Full control over
 * simulated elapsed time is also what makes "N frames over a window"
 * deterministic instead of depending on real wall-clock speed.
 *
 * The idle gap *between* windows (and the hidden-tab retry poll) is a real
 * `setTimeout`, not part of the rAF chain — vitest's fake timers drive that
 * half deterministically via `vi.advanceTimersByTime`.
 *
 * @see specs/components/adaptive-graphics-quality.feature
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsQualityProvider } from "../GraphicsQualityProvider";
import { useGraphicsQuality } from "~/hooks/useGraphicsQuality";
import { useGraphicsQualityOverrideStore } from "~/stores/graphicsQualityOverrideStore";

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
 * Simulates one sample window: a start frame at t=0, then `frames` more
 * frames evenly spaced across `windowMs` — the last of which lands exactly
 * on the window boundary, closing it. `frames` over `windowMs` is the
 * simulated frame rate for this window. Each window is timed relative to
 * its own start — the provider no longer ties window boundaries to a
 * shared rAF timestamp axis, so there's nothing to offset between calls.
 */
function runWindow({ windowMs, frames }: { windowMs: number; frames: number }) {
  fireFrame(0);
  for (let i = 1; i <= frames; i++) {
    fireFrame((windowMs / frames) * i);
  }
}

/** Advances the fake setTimeout clock that drives the idle gap between windows. */
function advanceIdleGap(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
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
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-reduced-graphics");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    useGraphicsQualityOverrideStore.setState({ override: "auto" });
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
      runWindow({ windowMs: 1000, frames: 2 });
      advanceIdleGap(1000);
      runWindow({ windowMs: 1000, frames: 2 });

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
      runWindow({ windowMs: 1000, frames: 90 });

      expect(
        document.documentElement.hasAttribute("data-reduced-graphics"),
      ).toBe(false);
      expect(screen.getByTestId("consumer").textContent).toBe("false");
    });

    /** @scenario "A single stray struggling window is not enough to degrade" */
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
      runWindow({ windowMs: 1000, frames: 2 });
      expect(screen.getByTestId("consumer").textContent).toBe("false");

      advanceIdleGap(1000);
      runWindow({ windowMs: 1000, frames: 90 });
      expect(screen.getByTestId("consumer").textContent).toBe("false");
    });

    /** @scenario "The background probe stays idle between checks" */
    it("does not run the frame-rate probe during the idle gap between windows", () => {
      render(
        <GraphicsQualityProvider
          sampleWindowMs={1000}
          resampleIntervalMs={60_000}
          minFps={50}
        >
          <Consumer />
        </GraphicsQualityProvider>,
      );

      // Close the first window — this is where the idle gap begins.
      runWindow({ windowMs: 1000, frames: 90 });

      // No rAF should be pending while waiting out the 60s resample
      // interval — the wait is a setTimeout sleep, not a rescheduled rAF
      // chain that fires on every paint for no reason.
      expect(pendingCallback).toBeNull();
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
      runWindow({ windowMs: 1000, frames: 2 });
      advanceIdleGap(1000);
      runWindow({ windowMs: 1000, frames: 2 });
      expect(screen.getByTestId("consumer").textContent).toBe("true");

      // Recovery only needs one smooth window.
      advanceIdleGap(1000);
      runWindow({ windowMs: 1000, frames: 90 });

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
          hiddenRetryMs={100}
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

      // Tab becomes visible again. The provider falls back to a cheap
      // setTimeout poll while hidden rather than spinning rAF — advance
      // that to let it notice and restart a clean window.
      setDocumentHidden(false);
      advanceIdleGap(100);
      runWindow({ windowMs: 1000, frames: 90 });

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

      runWindow({ windowMs: 1000, frames: 2 });
      advanceIdleGap(1000);
      runWindow({ windowMs: 1000, frames: 2 });

      expect(screen.getByTestId("consumer").textContent).toBe("true");
    });
  });

  describe("when a manual override is set", () => {
    /** @scenario "A manual choice to always reduce graphics is respected" */
    it("stays in reduced-graphics mode even while the probe would measure a smooth rate", () => {
      act(() => {
        useGraphicsQualityOverrideStore.setState({ override: "on" });
      });

      render(
        <GraphicsQualityProvider sampleWindowMs={1000} minFps={50}>
          <Consumer />
        </GraphicsQualityProvider>,
      );

      expect(screen.getByTestId("consumer").textContent).toBe("true");
      expect(
        document.documentElement.getAttribute("data-reduced-graphics"),
      ).toBe("true");
      // The probe is paused while overridden — nothing to measure, no
      // point spending rAF cycles on a result that would be discarded.
      expect(pendingCallback).toBeNull();
    });

    /** @scenario "A manual choice to never reduce graphics is respected" */
    it("never marks reduced-graphics mode even while the probe would measure a struggling rate", () => {
      act(() => {
        useGraphicsQualityOverrideStore.setState({ override: "off" });
      });

      render(
        <GraphicsQualityProvider sampleWindowMs={1000} minFps={50}>
          <Consumer />
        </GraphicsQualityProvider>,
      );

      expect(screen.getByTestId("consumer").textContent).toBe("false");
      expect(
        document.documentElement.hasAttribute("data-reduced-graphics"),
      ).toBe(false);
      expect(pendingCallback).toBeNull();
    });

    /** @scenario "Choosing automatic hands control back to the probe" */
    it("resumes the probe once switched back to automatic", () => {
      act(() => {
        useGraphicsQualityOverrideStore.setState({ override: "on" });
      });

      render(
        <GraphicsQualityProvider sampleWindowMs={1000} minFps={50}>
          <Consumer />
        </GraphicsQualityProvider>,
      );
      expect(pendingCallback).toBeNull();

      act(() => {
        useGraphicsQualityOverrideStore.setState({ override: "auto" });
      });

      // The probe resumes and, absent any measurement yet, defers to a
      // smooth default rather than staying stuck on the override's value.
      expect(pendingCallback).not.toBeNull();
      expect(screen.getByTestId("consumer").textContent).toBe("false");
    });
  });
});
