/**
 * Internal Set ID Utilities
 *
 * Provides functions for detecting and generating internal set IDs.
 * Internal sets use a distinct namespace to avoid collisions with user-created set names.
 *
 * Pattern: __internal__${projectId}__on-platform-scenarios
 *
 * @see specs/scenarios/internal-set-namespace.feature
 */

/** Prefix for all internal set IDs */
export const INTERNAL_SET_PREFIX = "__internal__";

/** Suffix for on-platform scenario sets */
export const ON_PLATFORM_SET_SUFFIX = "__on-platform-scenarios";

/** Friendly display name for on-platform sets */
export const ON_PLATFORM_DISPLAY_NAME = "On-Platform Scenarios";

/**
 * Checks if a set ID is an internal set (created by LangWatch platform).
 */
export function isInternalSetId(setId: string): boolean {
  return setId.startsWith(INTERNAL_SET_PREFIX);
}

/**
 * Checks if a set ID is specifically the on-platform scenarios set.
 */
export function isOnPlatformSet(setId: string): boolean {
  return setId.endsWith(ON_PLATFORM_SET_SUFFIX);
}

/**
 * Generates the internal set ID for on-platform scenarios for a given project.
 */
export function getOnPlatformSetId(projectId: string): string {
  return `${INTERNAL_SET_PREFIX}${projectId}${ON_PLATFORM_SET_SUFFIX}`;
}
