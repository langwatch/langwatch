import { nowInstant } from "@langwatch/time";

import type {
  RumRateLimitRepository,
  RumRateLimitResult,
  RumRateLimitWindow,
} from "../rum-rate-limit.repository.ts";

/** Expired windows are swept past this many keys, so a stream of distinct callers cannot leak. */
const SWEEP_THRESHOLD = 1_000;

/** The door's buckets, counted by this process alone. */
export class MemoryRumRateLimitRepository implements RumRateLimitRepository {
  readonly #windows = new Map<string, { count: number; expiresAt: number }>();

  private constructor() {}

  static create(): MemoryRumRateLimitRepository {
    return new MemoryRumRateLimitRepository();
  }

  limit({ key, windowSeconds, max }: RumRateLimitWindow): Promise<RumRateLimitResult> {
    const now = nowInstant().epochMilliseconds;
    this.#sweep(now);
    const open = this.#windows.get(key);
    const window =
      open !== undefined && open.expiresAt > now
        ? open
        : { count: 0, expiresAt: now + windowSeconds * 1000 };
    window.count += 1;
    this.#windows.set(key, window);
    return Promise.resolve({
      allowed: window.count <= max,
      remaining: Math.max(0, max - window.count),
      resetAt: window.expiresAt,
    });
  }

  /** How many buckets are open: what a refused flood must not grow. */
  countKeys(): number {
    return this.#windows.size;
  }

  #sweep(now: number): void {
    if (this.#windows.size < SWEEP_THRESHOLD) return;
    for (const [key, window] of this.#windows) {
      if (window.expiresAt <= now) this.#windows.delete(key);
    }
  }
}
