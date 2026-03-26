// ---------------------------------------------------------------------------
// Failure rate monitor (sliding window)
// ---------------------------------------------------------------------------

/**
 * Tracks failure timestamps in a sliding window. When the count exceeds
 * `threshold` within `windowMs`, `record()` returns `true` to signal an
 * alert. A cooldown prevents repeated alerts from flooding logs.
 */
export class FailureRateMonitor {
  readonly threshold: number;
  readonly windowMs: number;
  private readonly cooldownMs: number;
  private timestamps: number[] = [];
  private lastAlertAt = 0;

  constructor({
    threshold,
    windowMs,
    cooldownMs = 5 * 60_000,
  }: {
    threshold: number;
    windowMs: number;
    cooldownMs?: number;
  }) {
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
  }

  /**
   * Records a failure. Returns `true` when the threshold is breached and no
   * alert was fired within the cooldown period.
   */
  record(): boolean {
    const now = Date.now();
    this.timestamps.push(now);
    this.prune(now);

    if (this.timestamps.length < this.threshold) return false;
    if (now - this.lastAlertAt < this.cooldownMs) return false;

    this.lastAlertAt = now;
    return true;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    // timestamps are in order, so find first index >= cutoff
    let i = 0;
    while (i < this.timestamps.length && this.timestamps[i]! < cutoff) {
      i++;
    }
    if (i > 0) {
      this.timestamps = this.timestamps.slice(i);
    }
  }
}
