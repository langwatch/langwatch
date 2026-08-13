/**
 * Mulberry32 PRNG. Deterministic, no dependencies, good enough for bootstrap
 * resampling. Same seed → identical sequence across platforms.
 *
 * Shared rather than copied. Two bootstraps now feed the same chart — the
 * score interval and the mean-cost interval — and a second implementation
 * that drifted by one operation would make one of them silently
 * irreproducible while still looking fine.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
