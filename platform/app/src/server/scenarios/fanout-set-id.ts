/**
 * Fan-Out Set ID Utilities
 *
 * Provides functions for generating and detecting fan-out-batch-based set IDs.
 * Fan-out sets live under the __internal__ namespace (shared with on-platform
 * scenarios and suites) and use a __fanout suffix to distinguish them.
 *
 * Pattern: __internal__${batchId}__fanout
 *
 * @see specs/scenarios/adjacent-scenario-blast-radius.feature
 */

import { INTERNAL_SET_PREFIX } from "./internal-set-id";

/** Suffix that identifies a fan-out set ID */
export const FANOUT_SET_SUFFIX = "__fanout";

/**
 * Checks if a set ID belongs to a fan-out batch.
 */
export function isFanOutSetId(setId: string): boolean {
  // Length guard, not just prefix and suffix: without it a string where the
  // two overlap satisfies both checks and extraction returns an empty batch id.
  return (
    setId.length > INTERNAL_SET_PREFIX.length + FANOUT_SET_SUFFIX.length &&
    setId.startsWith(INTERNAL_SET_PREFIX) &&
    setId.endsWith(FANOUT_SET_SUFFIX)
  );
}

/**
 * Generates the set ID for a given fan-out batch.
 */
export function getFanOutSetId(batchId: string): string {
  return `${INTERNAL_SET_PREFIX}${batchId}${FANOUT_SET_SUFFIX}`;
}

/**
 * Extracts the batch ID from a fan-out set ID.
 * Returns null if the set ID is not a fan-out set ID.
 */
export function extractFanOutBatchId(setId: string): string | null {
  if (!isFanOutSetId(setId)) return null;
  return setId.slice(INTERNAL_SET_PREFIX.length, -FANOUT_SET_SUFFIX.length);
}
