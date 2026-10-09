import { nowInstant } from "@langwatch/time";

import type {
  BugReportRateLimitRepository,
  BugReportRateLimitWindow,
} from "../bug-report-rate-limit.repository.ts";

/** Expired windows are swept past this many keys, so a stream of distinct callers cannot leak. */
const SWEEP_THRESHOLD = 1_000;

/** The intake's buckets, counted by this process alone. */
export class MemoryBugReportRateLimitRepository implements BugReportRateLimitRepository {
  readonly #windows = new Map<string, { count: number; expiresAt: number }>();

  private constructor() {}

  static create(): MemoryBugReportRateLimitRepository {
    return new MemoryBugReportRateLimitRepository();
  }

  consume({
    key,
    windowSeconds,
    max,
  }: BugReportRateLimitWindow): Promise<Readonly<{ allowed: boolean }>> {
    const now = nowInstant().epochMilliseconds;
    this.#sweep(now);
    const open = this.#windows.get(key);
    const window =
      open !== undefined && open.expiresAt > now
        ? open
        : { count: 0, expiresAt: now + windowSeconds * 1000 };
    window.count += 1;
    this.#windows.set(key, window);
    return Promise.resolve({ allowed: window.count <= max });
  }

  #sweep(now: number): void {
    if (this.#windows.size < SWEEP_THRESHOLD) return;
    for (const [key, window] of this.#windows) {
      if (window.expiresAt <= now) this.#windows.delete(key);
    }
  }
}
