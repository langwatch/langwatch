/**
 * Samples frame rate via requestAnimationFrame; a struggling device flips
 * the app into reduced-graphics mode. @see specs/components/adaptive-graphics-quality.feature
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { evaluateFpsSample } from "../../model/evaluate-fps-sample";
import { GraphicsQualityContext } from "../../behavior/use-graphics-quality";
import { useGraphicsQualityOverrideStore } from "../../behavior/graphics-quality-override-store";

const RESAMPLE_INTERVAL_MS = 60_000;
const SAMPLE_WINDOW_MS = 1500;
const MIN_FPS = 50;
const CONSECUTIVE_STRUGGLING_SAMPLES = 2;
const HIDDEN_RETRY_MS = 1000;

function applyReducedGraphicsAttribute(reducedGraphics: boolean): void {
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
  children: ReactNode;
}) {
  const override = useGraphicsQualityOverrideStore();
  const [probeReducedGraphics, setProbeReducedGraphics] = useState(false);
  const probeReducedGraphicsRef = useRef(probeReducedGraphics);
  probeReducedGraphicsRef.current = probeReducedGraphics;

  const reducedGraphics = override === "auto" ? probeReducedGraphics : override === "on";

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
      // A window straddling a hidden period measures throttled frames
      // against real elapsed wall-clock time — discard rather than let it
      // read as a false frame-rate collapse.
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

  // Stable identity so a useGraphicsQuality() consumer only re-renders when
  // reducedGraphics actually changes, not on every override change.
  const contextValue = useMemo(() => ({ reducedGraphics }), [reducedGraphics]);

  return <GraphicsQualityContext value={contextValue}>{children}</GraphicsQualityContext>;
}
