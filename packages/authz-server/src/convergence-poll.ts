/**
 * The convergence wait's budget, shared by the three rollout migrations.
 *
 * A fixed deadline parks an organization for being large: the fold drains an
 * organization's stream in per-tenant FIFO at a measured rate on the order of
 * two facts a second, so a fixed 120s window deterministically times out past
 * a couple of hundred facts — the events are durable and land fine on a later
 * pass, but every first pass over a real organization reads as an error. The
 * deadline therefore scales with the number of facts the wait is actually
 * waiting on, bounded by a ceiling so one enormous organization cannot hold
 * the fleet-wide pass indefinitely (past the ceiling it parks and finishes on
 * a retry, which is the behavior every organization had before).
 *
 * An explicitly injected poll without `perFactMs` scales by nothing, which
 * keeps the timeout tests exact.
 */
export type ConvergencePoll = {
  intervalMs: number;
  /** The base budget, granted regardless of size. */
  timeoutMs: number;
  /** Extra budget per fact awaited. Absent means no scaling. */
  perFactMs?: number;
  /** Ceiling on the scaled budget. Absent means unbounded. */
  maxTimeoutMs?: number;
};

export const DEFAULT_CONVERGENCE_POLL: ConvergencePoll = {
  intervalMs: 500,
  timeoutMs: 120_000,
  // The measured fold rate is ~1.8 facts/s; a full second per fact leaves
  // room for the rate degrading under load before the deadline lies again.
  perFactMs: 1_000,
  maxTimeoutMs: 1_200_000,
};

export function convergenceTimeoutMs({
  poll,
  factCount,
}: {
  poll: ConvergencePoll;
  factCount: number;
}): number {
  const scaled = poll.timeoutMs + factCount * (poll.perFactMs ?? 0);
  return Math.min(scaled, poll.maxTimeoutMs ?? scaled);
}
