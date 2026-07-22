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
 * Skips sampling entirely for users who prefer reduced motion — the same
 * choice HomePageBanners' one-shot GPU health probe makes.
 *
 * The DOM attribute is the primary mechanism (works even for static Chakra
 * theme recipes, which can't read React state); the context
 * (useGraphicsQuality) is a secondary channel for the rare consumer that
 * needs the signal programmatically.
 */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { GraphicsQualityContext } from "~/hooks/useGraphicsQuality";
import { evaluateFpsSample } from "~/utils/evaluateFpsSample";

const RESAMPLE_INTERVAL_MS = 60_000;
const SAMPLE_WINDOW_MS = 1500;
const MIN_FPS = 50;

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
  children,
}: {
  resampleIntervalMs?: number;
  sampleWindowMs?: number;
  minFps?: number;
  children: React.ReactNode;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [reducedGraphics, setReducedGraphics] = useState(false);
  const reducedGraphicsRef = useRef(reducedGraphics);
  reducedGraphicsRef.current = reducedGraphics;

  useEffect(() => {
    applyReducedGraphicsAttribute(reducedGraphics);
  }, [reducedGraphics]);

  useEffect(() => {
    if (prefersReducedMotion) return;

    let rafId: number;
    let sample: { start: number; frames: number } | null = null;
    let nextSampleAt = 0;

    function tick(time: number) {
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
            if (isStruggling !== reducedGraphicsRef.current) {
              setReducedGraphics(isStruggling);
            }
            sample = null;
            nextSampleAt = time + resampleIntervalMs;
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [prefersReducedMotion, sampleWindowMs, minFps, resampleIntervalMs]);

  return (
    <GraphicsQualityContext value={{ reducedGraphics }}>
      {children}
    </GraphicsQualityContext>
  );
}
