/**
 * Targeting identity of a single feature flag read.
 *
 * A targeting rule on a flag names a project or an organization. The rule
 * can only match when the read carries that id, so a read that leaves an id
 * out silently loses every rule written for it. To stop that, every read
 * states both ids, and a caller that has no such id says so with
 * `NOT_TARGETED`.
 *
 * @see specs/ops/internal-feature-flags.feature
 */

/**
 * Explicit opt-out for a targeting scope that does not exist on the calling
 * surface, for example a page outside any project, or a screen shown before
 * login.
 *
 * A rule that names a project or an organization never matches a read that
 * opts that scope out, so the opt-out is a decision the caller makes on
 * purpose and not a value that can be forgotten.
 */
export const NOT_TARGETED = "__not_targeted__" as const;

export type NotTargeted = typeof NOT_TARGETED;

/**
 * The project or organization a flag read is about.
 *
 * - a real id: rules that name this project or organization can match.
 * - `NOT_TARGETED`: the surface has no such id at all. No rule that names
 *   this scope can match.
 * - `undefined`: the id is not known yet. Write it out and pair it with
 *   `enabled: false` so the read waits for the id instead of resolving
 *   against an empty context.
 */
export type FeatureFlagTargetId = string | NotTargeted | undefined;

/**
 * Converts a target id into the value the rule matcher compares against.
 * An opted-out or still-unknown scope becomes `undefined`, which no rule
 * naming that scope can match.
 */
export function toRuleContextId(id: FeatureFlagTargetId): string | undefined {
  return id === NOT_TARGETED ? undefined : id;
}
