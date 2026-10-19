/**
 * Rate limiter for recurring warning conditions; prevents log spam by counting suppressed calls.
 * @see specs/observability/slow-work-warnings.feature
 */

type ThrottleEntry = { lastWarnedAt: number; suppressed: number };

export type WarnThrottle = {
  /**
   * Claims a warning slot for `key`. Returns how many calls went unwarned
   * since this identity last warned, or undefined when it is still inside its
   * interval and must stay quiet.
   */
  claim: (params: { key: string; now: number }) => number | undefined;
  /** Drops all state. Process-wide state must not leak between tests. */
  reset: () => void;
};

export function createWarnThrottle(intervalMs: number): WarnThrottle {
  const state = new Map<string, ThrottleEntry>();

  return {
    claim({ key, now }) {
      const entry = state.get(key);
      if (entry && now - entry.lastWarnedAt < intervalMs) {
        entry.suppressed += 1;
        return undefined;
      }
      const suppressed = entry?.suppressed ?? 0;
      state.set(key, { lastWarnedAt: now, suppressed: 0 });
      return suppressed;
    },
    reset() {
      state.clear();
    },
  };
}
