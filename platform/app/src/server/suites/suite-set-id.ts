/**
 * Suite Set ID Utilities
 *
 * Provides functions for generating and detecting suite-based set IDs.
 * Suite sets live under the __internal__ namespace (shared with on-platform
 * scenarios) and use a __suite suffix to distinguish them.
 *
 * Pattern: __internal__${suiteId}__suite
 *
 * @see specs/suites/suite-workflow.feature
 */

import { INTERNAL_SET_PREFIX } from "../scenarios/internal-set-id";

/** Suffix that identifies a suite set ID */
export const SUITE_SET_SUFFIX = "__suite";

/**
 * Checks if a set ID belongs to a suite.
 */
export function isSuiteSetId(setId: string): boolean {
  return setId.startsWith(INTERNAL_SET_PREFIX) && setId.endsWith(SUITE_SET_SUFFIX);
}

/**
 * Generates the set ID for a given suite configuration.
 */
export function getSuiteSetId(suiteId: string): string {
  return `${INTERNAL_SET_PREFIX}${suiteId}${SUITE_SET_SUFFIX}`;
}

/**
 * Extracts the suite ID from a suite set ID.
 * Returns null if the set ID is not a suite set ID.
 */
export function extractSuiteId(setId: string): string | null {
  if (!isSuiteSetId(setId)) return null;
  return setId.slice(INTERNAL_SET_PREFIX.length, -SUITE_SET_SUFFIX.length);
}
