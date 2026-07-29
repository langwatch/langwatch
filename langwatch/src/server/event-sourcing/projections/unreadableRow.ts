import { isUnreadableColumnError } from "../services/errorHandling";

/**
 * What a read-back returns when the row exists but this build cannot decode it.
 *
 * A sentinel rather than `null` because the two answers are not the same: null
 * means "no row" (`miss: "absent"`, which the executor retries unwindowed),
 * this means "row found and unreadable" (`miss: "undecodable"`, which it must
 * NOT retry — a wider scope finds the same row and fails on it again).
 */
export const UNREADABLE_ROW = Symbol("UNREADABLE_ROW");

/**
 * Runs a fold read-back, answering {@link UNREADABLE_ROW} instead of throwing
 * when the row cannot be decoded.
 *
 * This is the one read failure a store answers rather than propagates. The row
 * is complete and the cluster is healthy — this build simply cannot decode one
 * of its columns (see {@link isUnreadableColumnError}), so no retry can ever
 * succeed. Letting it throw fails the job, the queue redelivers it, and the
 * aggregate's group stops making progress. Reported as a miss instead, the
 * fold rebuilds from `event_log` and writes the row back readable, which is
 * what ends the condition.
 *
 * Every other failure propagates untouched: an overloaded, timing-out or
 * unreachable cluster must be retried, never refolded on.
 */
export async function readBackOrUnreadable<T>(
  read: () => Promise<T>,
): Promise<T | typeof UNREADABLE_ROW> {
  try {
    return await read();
  } catch (error) {
    if (!isUnreadableColumnError(error)) throw error;
    return UNREADABLE_ROW;
  }
}
