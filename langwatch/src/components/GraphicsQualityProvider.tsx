/**
 * Periodically samples real frame rate via requestAnimationFrame and, when
 * the device can't sustain a smooth rate, flips the app into
 * reduced-graphics mode: decorative blur/backdrop effects switch to a plain
 * background instead (see the `--lw-backdrop-blur` CSS variable wired into
 * the theme recipes in src/pages/_app.tsx, and RunRow/GroupRow's sticky
 * headers).
 *
 * rAF only runs during the ~SAMPLE_WINDOW_MS window itself; the
 * RESAMPLE_INTERVAL_MS gap between windows is a plain setTimeout sleep, not
 * a continuously-rescheduled rAF loop — this thing is mounted at the app
 * root, so a bare `requestAnimationFrame` chain would otherwise fire on
 * every paint, forever, on every page, for no reason during the ~98% of
 * each cycle that isn't actively sampling.
 *
 * Re-samples every RESAMPLE_INTERVAL_MS so the app recovers automatically
 * once the device is no longer under load, not just degrades one-way.
 * Recovery only needs one smooth sample; entering reduced-graphics mode
 * requires CONSECUTIVE_STRUGGLING_SAMPLES in a row, so a single GC pause or
 * background task doesn't false-positive a fine device into the fallback.
 *
 * Runs regardless of the prefers-reduced-motion setting. This differs from
 * HomePageBanners' one-shot GPU probe, which IS skipped for reduced-motion
 * users — but there, reduced-motion already forces the same static outcome
 * the probe would produce, so skipping is a no-op. Backdrop-filter is a
 * static visual effect, not motion, and there's no equivalent force-static
 * path here, so skipping the probe for reduced-motion users would leave a
 * genuinely struggling device with no fallback for them at all.
 *
 * Pauses while the tab is hidden: requestAnimationFrame's timestamps stay
 * real wall-clock time even though callbacks are throttled in background
 * tabs, so a sample window straddling a period the tab spent hidden would
 * read as a catastrophic (and false) frame-rate drop. Any in-progress
 * sample is discarded the moment the tab backgrounds, and — rather than
 * keep polling via rAF while hidden — falls back to a cheap HIDDEN_RETRY_MS
 * setTimeout poll until the tab is visible again.
 *
 * The DOM attribute is the primary mechanism (works even for static Chakra
 * theme recipes, which can't read React state); the context
 * (useGraphicsQuality) is a secondary channel for the rare consumer that
 * needs the signal programmatically.
 *
 * A manual per-device override (useGraphicsQualityOverrideStore) sits on
 * top of the probe: "on"/"off" wins outright and the probe is paused
 * entirely (no point spending rAF/setTimeout cycles on a measurement that
 * would just be discarded); "auto" is today's probe-driven behavior.
 */
import { useEffect, useRef, useState } from "react";
import { GraphicsQualityContext } from "~/hooks/useGraphicsQuality";
import { useGraphicsQualityOverrideStore } from "~/stores/graphicsQualityOverrideStore";
import { evaluateFpsSample } from "~/utils/evaluateFpsSample";

const RESAMPLE_INTERVAL_MS = 60_000;
const SAMPLE_WINDOW_MS = 1500;
const MIN_FPS = 50;
const CONSECUTIVE_STRUGGLING_SAMPLES = 2;
const HIDDEN_RETRY_MS = 1000;

function applyReducedGraphicsAttribute(reducedGraphics: boolean) {
  if (typeof document === "undefined") return;
  if (reducedGraphics) {
    document.documentElement.setAttribute("data-reduced-graphics", "true");
  } else {
    document.documentElement.removeAttribute("data-reduced-graphics");
  }
}

export function GraphicsQualityProvider({
  resampleIntervalMs = RESAMPLE_INTERVAL_MS,
  sampleWindowMs = SAMPLE_WINDOW_MS,
  minFps = MIN_FPS,
  consecutiveStrugglingSamples = CONSECUTIVE_STRUGGLING_SAMPLES,
  hiddenRetryMs = HIDDEN_RETRY_MS,
  children,
}: {
  resampleIntervalMs?: number;
  sampleWindowMs?: number;
  minFps?: number;
  consecutiveStrugglingSamples?: number;
  hiddenRetryMs?: number;
  children: React.ReactNode;
}) {
  const override = useGraphicsQualityOverrideStore((s) => s.override);
  const [probeReducedGraphics, setProbeReducedGraphics] = useState(false);
  const probeReducedGraphicsRef = useRef(probeReducedGraphics);
  probeReducedGraphicsRef.current = probeReducedGraphics;

  const reducedGraphics =
    override === "auto" ? probeReducedGraphics : override === "on";

  useEffect(() => {
    applyReducedGraphicsAttribute(reducedGraphics);
  }, [reducedGraphics]);

  useEffect(() => {
    if (override !== "auto") return;

    let rafId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let sample: { start: number; frames: number } | null = null;
    let strugglingStreak = 0;

    function scheduleNextWindow(delayMs: number) {
      timeoutId = setTimeout(startWindow, delayMs);
    }

    function startWindow() {
      if (document.hidden) {
        scheduleNextWindow(hiddenRetryMs);
        return;
      }
      sample = null;
      rafId = requestAnimationFrame(measureFrame);
    }

    function measureFrame(time: number) {
      if (document.hidden) {
        sample = null;
        scheduleNextWindow(hiddenRetryMs);
        return;
      }
      if (!sample) {
        sample = { start: time, frames: 0 };
        rafId = requestAnimationFrame(measureFrame);
        return;
      }
      sample.frames++;
      const elapsed = time - sample.start;
      if (elapsed < sampleWindowMs) {
        rafId = requestAnimationFrame(measureFrame);
        return;
      }
      const isStruggling = evaluateFpsSample({
        frames: sample.frames,
        elapsedMs: elapsed,
        minFps,
      });
      strugglingStreak = isStruggling ? strugglingStreak + 1 : 0;
      const shouldReduceGraphics = isStruggling
        ? strugglingStreak >= consecutiveStrugglingSamples
        : false;
      if (shouldReduceGraphics !== probeReducedGraphicsRef.current) {
        setProbeReducedGraphics(shouldReduceGraphics);
      }
      sample = null;
      scheduleNextWindow(resampleIntervalMs);
    }

    function handleVisibilityChange() {
      // A window that straddles a hidden period measures throttled frames
      // against real elapsed wall-clock time — discard it rather than let
      // it read as a false frame-rate collapse.
      if (document.hidden) {
        sample = null;
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    startWindow();

    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    override,
    sampleWindowMs,
    minFps,
    resampleIntervalMs,
    consecutiveStrugglingSamples,
    hiddenRetryMs,
  ]);

  return (
    <GraphicsQualityContext value={{ reducedGraphics }}>
      {children}
    </GraphicsQualityContext>
  );
}
