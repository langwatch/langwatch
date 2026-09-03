/**
 * Rate limiter for warnings that describe a recurring condition.
 *
 * Work that is slow is usually slow on every call, so a warning per call
 * buries every other line in the log. That is what got the ClickHouse
 * slow-query warning removed in #6114, and it is the reason this exists rather
 * than a bare threshold comparison at each call site.
 *
 * One identity warns at most once per interval. The calls that go unwarned are
 * counted, and the next warning that gets through reports the count, so the
 * log understates how often a condition happened but never hides that it did.
 *
 * Lives in the observability package rather than in one application: both
 * callers sit below any application layer — the Prisma client's slow-query
 * warning, and the tRPC call logger.
 *
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
