/**
 * Suite Set ID Utilities
 *
 * Provides functions for generating and detecting suite-based set IDs.
 * Suite sets use a distinct namespace to avoid collisions with
 * internal on-platform sets and user-created set names.
 *
 * Pattern: __suite__${suiteId}
 *
 * @see specs/suites/suite-workflow.feature
 */

/** Prefix for all suite set IDs */
export const SUITE_SET_PREFIX = "__suite__";

/**
 * Checks if a set ID belongs to a suite.
 */
export function isSuiteSetId(setId: string): boolean {
  return setId.startsWith(SUITE_SET_PREFIX);
}

/**
 * Generates the set ID for a given suite configuration.
 */
export function getSuiteSetId(suiteId: string): string {
  return `${SUITE_SET_PREFIX}${suiteId}`;
}
