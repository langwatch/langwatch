/** Maximum number of repeat runs allowed per suite execution */
export const MAX_REPEAT_COUNT = 5;

/** Suffix appended to a suite's slug when archived, freeing the original slug */
export const ARCHIVED_SLUG_SUFFIX = "--archived";

/**
 * Label that marks the managed per-project "run all test cases" suite.
 *
 * The suite is found by this label, never by name or slug: a person can name
 * their own plan "All test cases" without colliding with the managed one.
 */
export const RUN_ALL_SUITE_LABEL = "managed:run-all";

/** Display name of the managed "run all test cases" suite. */
export const RUN_ALL_SUITE_NAME = "All test cases";
