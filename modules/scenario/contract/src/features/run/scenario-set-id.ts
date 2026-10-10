/** Internal Set ID Utilities: detects and generates internal set IDs using
 * distinct namespace to avoid collisions with user-created names.
 */

/** Prefix for all internal set IDs */
export const INTERNAL_SET_PREFIX = "__internal__";

/** Suffix for on-platform scenario sets */
export const ON_PLATFORM_SET_SUFFIX = "__on-platform-scenarios";

/** Friendly display name for on-platform ad-hoc runs (single scenario "Save and Run") */
export const ON_PLATFORM_DISPLAY_NAME = "Manual Run";

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
  return setId.startsWith(INTERNAL_SET_PREFIX) && setId.endsWith(ON_PLATFORM_SET_SUFFIX);
}

/**
 * Generates the internal set ID for on-platform scenarios for a given project.
 */
export function getOnPlatformSetId(projectId: string): string {
  return `${INTERNAL_SET_PREFIX}${projectId}${ON_PLATFORM_SET_SUFFIX}`;
}

/** The canonical default set ID used when none is specified */
export const DEFAULT_SET_ID = "default";

/**
 * Expands a scenarioSetId into the list of values to match in queries.
 * Handles backwards-compatibility with data written before the empty-string
 * coercion fix: old rows may have ScenarioSetId = "" while new rows have "default".
 */
export function expandSetIdFilter(scenarioSetId: string): string[] {
  if (scenarioSetId === DEFAULT_SET_ID || scenarioSetId === "") {
    return [DEFAULT_SET_ID, ""];
  }
  return [scenarioSetId];
}

/** Set for voice call runs; excluded from project's scenario sets like
 * agent test set. Defined here to avoid duplication with voice agent config.
 */
export const VOICE_CALL_SCENARIO_SET_ID = "voice-calls";
