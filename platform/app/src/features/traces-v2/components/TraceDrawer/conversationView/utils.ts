/**
 * Human-readable wall-clock gap between two turns, e.g. "12.5s gap",
 * "3m 4s gap", "1h 2m gap". Surfaces how long the user was away between turns.
 */
export function formatGap(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s gap`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}m ${s}s gap`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m gap`;
}
