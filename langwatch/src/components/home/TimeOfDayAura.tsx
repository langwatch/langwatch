import { chakra } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type { TimeOfDay } from "./WelcomeHeader";

/**
 * The day's light, painted on a canvas: two soft radial blobs leaking in from
 * the panel's top-left corner, drifting almost imperceptibly. Rendered in
 * Display-P3 when the screen supports it (the same HDR treatment as the
 * accent tokens — see asaplangy task #25), with byte-equivalent sRGB
 * fallbacks. Reduced motion paints a single still frame. Whisper-weight by
 * design: light on a wall, not a spotlight.
 */

interface AuraBlob {
  /** Colour in both gamuts, as unit-channel P3 and 0-255 sRGB. */
  p3: [number, number, number];
  srgb: [number, number, number];
  alpha: number;
  /** Centre, as a fraction of the canvas width / a px offset from the top. */
  x: number;
  y: number;
  radius: number;
}

const PALETTES: Record<TimeOfDay, AuraBlob[]> = {
  morning: [
    // Sunrise gold with a rose fringe.
    { p3: [1, 0.76, 0.3], srgb: [251, 191, 36], alpha: 0.26, x: 0.03, y: 20, radius: 340 },
    { p3: [1, 0.5, 0.48], srgb: [251, 113, 133], alpha: 0.13, x: 0.17, y: -10, radius: 280 },
  ],
  afternoon: [
    // Open daylight with a pale haze.
    { p3: [0.42, 0.68, 1], srgb: [96, 165, 250], alpha: 0.2, x: 0.03, y: 20, radius: 340 },
    { p3: [0.85, 0.94, 1], srgb: [224, 242, 254], alpha: 0.08, x: 0.16, y: 0, radius: 260 },
  ],
  evening: [
    // Dusk violet sinking into indigo.
    { p3: [0.58, 0.4, 1], srgb: [139, 92, 246], alpha: 0.22, x: 0.03, y: 20, radius: 340 },
    { p3: [0.32, 0.28, 0.75], srgb: [79, 70, 229], alpha: 0.13, x: 0.18, y: -8, radius: 300 },
  ],
};

export function TimeOfDayAura({ timeOfDay }: { timeOfDay: TimeOfDay }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduceMotion = useReducedMotion();
  const timeOfDayRef = useRef(timeOfDay);
  timeOfDayRef.current = timeOfDay;
  const drawRef = useRef<((t: number) => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Wide gamut when available; a plain sRGB context everywhere else.
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d", { colorSpace: "display-p3" });
    } catch {
      ctx = null;
    }
    ctx ??= canvas.getContext("2d");
    if (!ctx) return;
    const p3 =
      (
        ctx.getContextAttributes?.() as
          | { colorSpace?: string }
          | undefined
      )?.colorSpace === "display-p3";

    const paint = (blob: AuraBlob, alpha: number) =>
      p3
        ? `color(display-p3 ${blob.p3[0]} ${blob.p3[1]} ${blob.p3[2]} / ${alpha})`
        : `rgba(${blob.srgb[0]}, ${blob.srgb[1]}, ${blob.srgb[2]}, ${alpha})`;

    let raf = 0;
    let disposed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w < 8 || h < 8) return;
      ctx.clearRect(0, 0, w, h);
      const blobs = PALETTES[timeOfDayRef.current];
      blobs.forEach((blob, i) => {
        // A drift you feel rather than see: a few px, out of phase per blob.
        const cx =
          blob.x * w + Math.sin(t * 0.00012 + i * 2.1) * 10;
        const cy = blob.y + Math.cos(t * 0.00009 + i * 1.3) * 8;
        const breathe = 1 + Math.sin(t * 0.0001 + i) * 0.05;
        const gradient = ctx.createRadialGradient(
          cx,
          cy,
          0,
          cx,
          cy,
          blob.radius * breathe,
        );
        gradient.addColorStop(0, paint(blob, blob.alpha));
        gradient.addColorStop(1, paint(blob, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      });
    };
    drawRef.current = draw;

    const observer = new ResizeObserver(() => {
      resize();
      if (reduceMotion) draw(0);
    });
    observer.observe(canvas);
    resize();

    if (reduceMotion) {
      draw(0);
    } else {
      const loop = (t: number) => {
        if (disposed) return;
        draw(t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      drawRef.current = null;
    };
  }, [reduceMotion]);

  // A time-of-day flip (midnight owl, dev switcher) repaints the still frame.
  useEffect(() => {
    if (reduceMotion) drawRef.current?.(0);
  }, [timeOfDay, reduceMotion]);

  return (
    <chakra.canvas
      ref={canvasRef}
      aria-hidden
      position="absolute"
      inset={0}
      width="100%"
      height="100%"
      pointerEvents="none"
      zIndex={0}
      opacity={{ base: 0.5, _dark: 0.65 }}
    />
  );
}
