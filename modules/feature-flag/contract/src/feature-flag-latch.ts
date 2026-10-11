import { nowInstant } from "@langwatch/time";

import type { FeatureFlagKey } from "./feature-flag.ts";

/** How long an answer is trusted before the next read starts a background refresh. */
export const FEATURE_FLAG_LATCH_REFRESH_MS = 60_000;

type Answer = { on: boolean; readAt: number };

/**
 * A flag read with no I/O on the caller's path: `isOn(key)` answers the last value from memory,
 * false until the first answer lands, and an answer older than `refreshMs` starts one background
 * refresh that is never awaited. An owner builds it over its own `FeatureFlagApi` (id-index §2).
 */
export class FeatureFlagLatch {
  private readonly answers = new Map<FeatureFlagKey, Answer>();
  private readonly reading = new Set<FeatureFlagKey>();
  private readonly isEnabled: (key: FeatureFlagKey) => Promise<boolean>;
  private readonly refreshMs: number;
  private readonly now: () => number;

  constructor({
    isEnabled,
    refreshMs = FEATURE_FLAG_LATCH_REFRESH_MS,
    now = () => nowInstant().epochMilliseconds,
  }: {
    isEnabled: (key: FeatureFlagKey) => Promise<boolean>;
    refreshMs?: number;
    now?: () => number;
  }) {
    this.isEnabled = isEnabled;
    this.refreshMs = refreshMs;
    this.now = now;
  }

  isOn(key: FeatureFlagKey): boolean {
    const answer = this.answers.get(key);
    if (answer === undefined || this.now() - answer.readAt >= this.refreshMs) this.refresh(key);
    return answer?.on ?? false;
  }

  /** One read per key at a time; a failed read keeps the last answer and retries next time. */
  private refresh(key: FeatureFlagKey): void {
    if (this.reading.has(key)) return;
    this.reading.add(key);
    void this.isEnabled(key)
      .then(
        (on) => {
          this.answers.set(key, { on, readAt: this.now() });
        },
        () => undefined,
      )
      .finally(() => {
        this.reading.delete(key);
      });
  }
}
