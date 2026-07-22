/**
 * Periodically samples real frame rate via requestAnimationFrame and, when
 * the device can't sustain a smooth rate, flips the app into
 * reduced-graphics mode: decorative blur/backdrop effects switch to a plain
 * background instead (see the `--lw-backdrop-blur` CSS variable wired into
 * the theme recipes in src/pages/_app.tsx, and RunRow/GroupRow's sticky
 * headers).
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
 * Pauses while the tab is hidden: requestAnimationFrame is throttled (or
 * stops firing) in background tabs, but its timestamps stay real wall-clock
 * time, so a sample window straddling a period the tab spent hidden would
 * read as a catastrophic (and false) frame-rate drop. Any in-progress
 * sample is discarded on visibilitychange and restarted clean once visible.
 *
 * The DOM attribute is the primary mechanism (works even for static Chakra
 * theme recipes, which can't read React state); the context
 * (useGraphicsQuality) is a secondary channel for the rare consumer that
 * needs the signal programmatically.
 */
import { useEffect, useRef, useState } from "react";
import { GraphicsQualityContext } from "~/hooks/useGraphicsQuality";
import { evaluateFpsSample } from "~/utils/evaluateFpsSample";

const RESAMPLE_INTERVAL_MS = 60_000;
const SAMPLE_WINDOW_MS = 1500;
const MIN_FPS = 50;
const CONSECUTIVE_STRUGGLING_SAMPLES = 2;

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
  children,
}: {
  resampleIntervalMs?: number;
  sampleWindowMs?: number;
  minFps?: number;
  consecutiveStrugglingSamples?: number;
  children: React.ReactNode;
}) {
  const [reducedGraphics, setReducedGraphics] = useState(false);
  const reducedGraphicsRef = useRef(reducedGraphics);
  reducedGraphicsRef.current = reducedGraphics;

  useEffect(() => {
    applyReducedGraphicsAttribute(reducedGraphics);
  }, [reducedGraphics]);

  useEffect(() => {
    let rafId: number;
    let sample: { start: number; frames: number } | null = null;
    let nextSampleAt = 0;
    let strugglingStreak = 0;

    function handleVisibilityChange() {
      // A window that straddles a hidden period measures throttled frames
      // against real elapsed wall-clock time — discard it rather than let
      // it read as a false frame-rate collapse.
      if (document.hidden) {
        sample = null;
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    function tick(time: number) {
      if (document.hidden) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (time >= nextSampleAt) {
        if (!sample) {
          sample = { start: time, frames: 0 };
        } else {
          sample.frames++;
          const elapsed = time - sample.start;
          if (elapsed >= sampleWindowMs) {
            const isStruggling = evaluateFpsSample({
              frames: sample.frames,
              elapsedMs: elapsed,
              minFps,
            });
            strugglingStreak = isStruggling ? strugglingStreak + 1 : 0;
            const shouldReduceGraphics = isStruggling
              ? strugglingStreak >= consecutiveStrugglingSamples
              : false;
            if (shouldReduceGraphics !== reducedGraphicsRef.current) {
              setReducedGraphics(shouldReduceGraphics);
            }
            sample = null;
            nextSampleAt = time + resampleIntervalMs;
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [sampleWindowMs, minFps, resampleIntervalMs, consecutiveStrugglingSamples]);

  return (
    <GraphicsQualityContext value={{ reducedGraphics }}>
      {children}
    </GraphicsQualityContext>
  );
}
