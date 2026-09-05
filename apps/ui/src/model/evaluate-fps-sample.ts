/**
 * Evaluates a single frame-rate sample window against a floor. Pure, so the
 * GraphicsQualityProvider probe's struggling/smooth math is testable without
 * a browser.
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
