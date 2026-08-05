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

export const FANOUT_SET_SUFFIX = "__fanout";

export function isFanOutSetId(setId: string): boolean {
  // Length guard, not just prefix and suffix: without it a string where the
  // two overlap satisfies both checks and extraction returns an empty batch id.
  return (
    setId.length > INTERNAL_SET_PREFIX.length + FANOUT_SET_SUFFIX.length &&
    setId.startsWith(INTERNAL_SET_PREFIX) &&
    setId.endsWith(FANOUT_SET_SUFFIX)
  );
}

export function getFanOutSetId(batchId: string): string {
  return `${INTERNAL_SET_PREFIX}${batchId}${FANOUT_SET_SUFFIX}`;
}

export function extractFanOutBatchId(setId: string): string | null {
  if (!isFanOutSetId(setId)) return null;
  return setId.slice(INTERNAL_SET_PREFIX.length, -FANOUT_SET_SUFFIX.length);
}
