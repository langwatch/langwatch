/**
 * Deterministic PRNG for the agent-economics seed, ported verbatim from the
 * prototype's `src/lib/data/prng.ts` so the same key yields the same stream.
 *
 * Every stream is sub-seeded from SEED + a purpose key, so adding an entity
 * never reshuffles existing data and any id regenerates its own content.
 */

/** The fixed base seed. Matches the prototype's catalog SEED so ported world
 * generators reproduce the prototype's magnitudes. */
export const SEED = 20260803;

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next10: () => number;

  constructor(key: string) {
    this.next10 = mulberry32(hashString(`${SEED}:${key}`));
  }

  next(): number {
    return this.next10();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [value, w] of items) {
      r -= w;
      if (r <= 0) return value;
    }
    return items[items.length - 1]![0];
  }

  /** base × uniform(1−spread … 1+spread) */
  jitter(base: number, spread: number): number {
    return base * (1 + (this.next() * 2 - 1) * spread);
  }

  /** skewed multiplicative noise, occasionally heavy, so it feels like real usage */
  burst(base: number, spread: number, burstChance = 0.06, burstScale = 2.6): number {
    const b = this.chance(burstChance) ? burstScale : 1;
    return this.jitter(base, spread) * b;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}
