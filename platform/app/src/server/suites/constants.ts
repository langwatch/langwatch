/** Maximum number of repeat runs allowed per suite execution */
export const MAX_REPEAT_COUNT = 5;

/** Suffix appended to a suite's slug when archived, freeing the original slug */
export const ARCHIVED_SLUG_SUFFIX = "--archived";

/**
 * Label that marks the managed per-project "run all scenarios" suite.
 *
 * The suite is found by this label, never by name or slug: a person can name
 * their own plan "All scenarios" without colliding with the managed one.
 */
export const RUN_ALL_SUITE_LABEL = "managed:run-all";

/** Display name of the managed "run all scenarios" suite. */
export const RUN_ALL_SUITE_NAME = "All scenarios";

/**
 * Label the command line puts on the throwaway suite it makes for
 * `langwatch scenario run`, written in
 * sdks/typescript/src/cli/commands/scenarios/run.ts.
 *
 * A run plan resolved by name skips these rows. The command line archives its
 * suite as soon as the run is queued, so joining one would attach a person's
 * run to a plan that is about to disappear from every list.
 */
export const CLI_EPHEMERAL_LABEL = "cli-ephemeral";
