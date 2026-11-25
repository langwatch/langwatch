import {
  evaluateFpsSample,
  GraphicsQualityContext,
  useGraphicsQualityOverrideStore,
} from "@langwatch/browser-host/facilities";
/**
 * Samples frame rate via requestAnimationFrame; a struggling device flips
 * the app into reduced-graphics mode. @see specs/components/adaptive-graphics-quality.feature
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

type FrameRateProbeOptions = {
  sampleWindowMs: number;
  minFps: number;
  resampleIntervalMs: number;
  consecutiveStrugglingSamples: number;
  hiddenRetryMs: number;
  isReduced: () => boolean;
  setReduced: (reduced: boolean) => void;
};

/** One sampling loop: a window of animation frames, judged, then a wait before the next. */
class FrameRateProbe {
  private rafId: number | undefined;
  private timeoutId: ReturnType<typeof setTimeout> | undefined;
  private sample: { start: number; frames: number } | null = null;
  private strugglingStreak = 0;
  private readonly options: FrameRateProbeOptions;
  private readonly onVisibilityChange = () => {
    // A window straddling a hidden period measures throttled frames against
    // real elapsed wall-clock time; discard it rather than read a false collapse.
    if (document.hidden) this.sample = null;
  };
  private readonly onFrame = (time: number) => this.measureFrame(time);
  private readonly onWindow = () => this.startWindow();

  constructor(options: FrameRateProbeOptions) {
    this.options = options;
  }

  start(): void {
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.startWindow();
  }

  stop(): void {
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    if (this.timeoutId !== undefined) clearTimeout(this.timeoutId);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private scheduleNextWindow(delayMs: number): void {
    this.timeoutId = setTimeout(this.onWindow, delayMs);
  }

  private startWindow(): void {
    if (document.hidden) {
      this.scheduleNextWindow(this.options.hiddenRetryMs);
      return;
    }
    this.sample = null;
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  private measureFrame(time: number): void {
    if (document.hidden) {
      this.sample = null;
      this.scheduleNextWindow(this.options.hiddenRetryMs);
      return;
    }
    if (!this.sample) {
      this.sample = { start: time, frames: 0 };
      this.rafId = requestAnimationFrame(this.onFrame);
      return;
    }
    this.sample.frames++;
    const elapsed = time - this.sample.start;
    if (elapsed < this.options.sampleWindowMs) {
      this.rafId = requestAnimationFrame(this.onFrame);
      return;
    }
    this.judgeWindow({ frames: this.sample.frames, elapsed });
    this.sample = null;
    this.scheduleNextWindow(this.options.resampleIntervalMs);
  }

  private judgeWindow({ frames, elapsed }: { frames: number; elapsed: number }): void {
    const { minFps, consecutiveStrugglingSamples, isReduced, setReduced } = this.options;
    const isStruggling = evaluateFpsSample({ frames, elapsedMs: elapsed, minFps });
    this.strugglingStreak = isStruggling ? this.strugglingStreak + 1 : 0;
    const shouldReduceGraphics = isStruggling
      ? this.strugglingStreak >= consecutiveStrugglingSamples
      : false;
    if (shouldReduceGraphics !== isReduced()) setReduced(shouldReduceGraphics);
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

    const probe = new FrameRateProbe({
      sampleWindowMs,
      minFps,
      resampleIntervalMs,
      consecutiveStrugglingSamples,
      hiddenRetryMs,
      isReduced: () => probeReducedGraphicsRef.current,
      setReduced: setProbeReducedGraphics,
    });
    probe.start();
    return () => probe.stop();
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
