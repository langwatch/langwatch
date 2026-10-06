/**
 * Deterministic randomness for the dashboards demo, ported from the prototype's prng.ts:
 * every stream is seeded from a key, so a re-run regenerates the same traces.
 */

const SEED = "langwatch-dashboards-demo";

export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DemoRandom {
  private readonly nextValue: () => number;

  constructor(key: string) {
    this.nextValue = mulberry32(hashString(`${SEED}:${key}`));
  }

  next(): number {
    return this.nextValue();
  }

  int({ min, max }: { min: number; max: number }): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("Cannot pick from an empty list");
    return item;
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
    let remaining = this.next() * total;
    for (const [value, weight] of items) {
      remaining -= Math.max(0, weight);
      if (remaining <= 0) return value;
    }
    const last = items[items.length - 1];
    if (last === undefined) throw new Error("Cannot pick from an empty list");
    return last[0];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** A log-normal draw with this median, spread so that p95 is about `p95 / median` times it. */
  logNormal({ median, p95 }: { median: number; p95: number }): number {
    const sigma = Math.log(Math.max(p95 / median, 1.0001)) / 1.645;
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return median * Math.exp(sigma * normal);
  }

  /** A short stable id, hex. */
  id(): string {
    return Math.floor(this.next() * 2 ** 32)
      .toString(16)
      .padStart(8, "0");
  }
}
