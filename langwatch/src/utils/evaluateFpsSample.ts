/**
 * Evaluates a single frame-rate sample window against a floor.
 *
 * Extracted from the GPU health probe in HomePageBanners.tsx so the same
 * struggling/smooth math can be reused by the periodic, app-wide
 * GraphicsQualityProvider probe.
 */
export function evaluateFpsSample({
  frames,
  elapsedMs,
  minFps,
}: {
  frames: number;
  elapsedMs: number;
  minFps: number;
}): boolean {
  if (elapsedMs <= 0) return true;
  const fps = (frames / elapsedMs) * 1000;
  return fps < minFps;
}
