/**
 * Lets a settlement refusal that only the customer can fix be logged once per
 * automation and refusal code in a window, not once per firing. A broken
 * automation fires on every match, so a per-firing line is a flood that
 * repeats the same fact (the author re-saves the automation to end it).
 * State is per process: a restart or a second worker logs the line again,
 * which is the intended upper bound.
 */
export const CONFIGURATION_REFUSAL_WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_REFUSALS = 5_000;

export class ConfigurationRefusalThrottle {
  private readonly lastLoggedAt = new Map<string, number>();

  private constructor(
    private readonly now: () => number,
    private readonly windowMs: number,
  ) {}

  static create({
    now = Date.now,
    windowMs = CONFIGURATION_REFUSAL_WINDOW_MS,
  }: { now?: () => number; windowMs?: number } = {}): ConfigurationRefusalThrottle {
    return new ConfigurationRefusalThrottle(now, windowMs);
  }

  /** True when this automation's refusal has not been logged inside the window. */
  shouldLog({ triggerId, code }: { triggerId: string; code: string }): boolean {
    const key = `${triggerId}:${code}`;
    const at = this.now();
    const last = this.lastLoggedAt.get(key);
    if (last !== undefined && at - last < this.windowMs) return false;

    if (this.lastLoggedAt.size >= MAX_TRACKED_REFUSALS) {
      for (const [tracked, loggedAt] of this.lastLoggedAt) {
        if (at - loggedAt >= this.windowMs) this.lastLoggedAt.delete(tracked);
      }
    }
    this.lastLoggedAt.delete(key);
    if (this.lastLoggedAt.size >= MAX_TRACKED_REFUSALS) {
      const oldest = this.lastLoggedAt.keys().next().value;
      if (oldest !== undefined) this.lastLoggedAt.delete(oldest);
    }
    this.lastLoggedAt.set(key, at);

    return true;
  }
}
