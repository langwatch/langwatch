/**
 * Browser-side vocabulary for flag read targeting scope; every read states
 * all ids (or NOT_TARGETED).
 */

/**
 * Explicit opt-out for a targeting scope that doesn't exist on the calling
 * surface (e.g., a page outside any project).
 */
export const NOT_TARGETED = "__not_targeted__" as const;

export type NotTargeted = typeof NOT_TARGETED;

/**
 * The project or organization a flag read is about (a real id, NOT_TARGETED,
 * or undefined if not yet known).
 */
export type FeatureFlagTargetId = string | undefined;

/**
 * Converts a target id into the value the rule matcher compares against.
 * An opted-out or still-unknown scope becomes `undefined`, which no rule
 * naming that scope can match.
 */
export function toRuleContextId(id: FeatureFlagTargetId): string | undefined {
  return id === NOT_TARGETED ? undefined : id;
}
