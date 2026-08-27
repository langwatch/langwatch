import { z } from "zod";
import { isWithinRolloutPercentage } from "./feature-flag-bucketing";

/**
 * Targeting-rule contract for postgres-backed feature flags.
 *
 * Rules sit on `FeatureFlag.rules` as a JSON array. The store walks
 * them in order at evaluation time; the first rule whose `match`
 * conditions all hold against the calling context wins. When no rule
 * matches, the row's `enabled` boolean is used as the row-level
 * default. When the row itself is missing, the resolver falls
 * through to the registry default.
 *
 * The shape is intentionally open-ended — today it carries `projectId`,
 * `organizationId` and a whole-percent `percentage`, and can grow further
 * conditions without a schema migration.
 */

const KNOWN_MATCH_KEYS = ["projectId", "organizationId", "percentage"] as const;
type KnownMatchKey = (typeof KNOWN_MATCH_KEYS)[number];

const featureFlagRuleMatchSchema = z
  .object({
    projectId: z.string().optional(),
    organizationId: z.string().optional(),
    /**
     * Whole-percent rollout across the rule's remaining audience. Combined
     * with the other conditions rather than replacing them, so "20% of this
     * organization" is one rule.
     */
    percentage: z.number().int().min(0).max(100).optional(),
  })
  // Future-proof: keep unknown fields on the parsed object rather than
  // rejecting them, so a newer writer can ship a rule shape the running
  // reader doesn't know yet and old rows keep deserializing after we
  // extend the schema. The matcher itself fails closed on unknown keys
  // (see matchesContext) so an unrecognized condition never silently
  // matches every context.
  .passthrough();

export const featureFlagRuleSchema = z.object({
  match: featureFlagRuleMatchSchema,
  enabled: z.boolean(),
});

export const featureFlagRulesSchema = z.array(featureFlagRuleSchema);

export type FeatureFlagRuleMatch = z.infer<typeof featureFlagRuleMatchSchema>;
export type FeatureFlagRule = z.infer<typeof featureFlagRuleSchema>;
export type FeatureFlagRules = z.infer<typeof featureFlagRulesSchema>;

export interface RuleEvaluationContext {
  projectId?: string;
  organizationId?: string;
  /**
   * The stable identity a percentage rule buckets on: the user for an
   * authenticated target, the anonymous browser id for an anonymous one.
   * Absent for system and other non-person callers, which never satisfy a
   * percentage rule.
   */
  bucketingId?: string;
}

/**
 * Parses an unknown rules payload (typically straight off the JSONB
 * column) into the typed shape. Returns an empty list when the input
 * is null/undefined or fails validation — never throws — because a
 * malformed rules blob must not turn a flag check into a 500.
 */
export function parseRules(input: unknown): FeatureFlagRules {
  if (input == null) return [];
  const result = featureFlagRulesSchema.safeParse(input);
  return result.success ? result.data : [];
}

/**
 * Walk rules in order and return the first match's `enabled`. When
 * no rule matches, returns null so callers can fall back to the
 * row-level default.
 */
export function evaluateRules(
  rules: FeatureFlagRules,
  ctx: RuleEvaluationContext,
  flagKey: string,
): boolean | null {
  for (const rule of rules) {
    if (matchesContext(rule.match, ctx, flagKey)) return rule.enabled;
  }
  return null;
}

/**
 * Compute the "default context" effective value for the Ops listing
 * UI — what a feature-flag check would resolve to for a caller with no
 * project/organization context. This mirrors the resolver chain so the
 * table can't contradict runtime behavior: env override beats any
 * empty-match rule, which beats the row-level toggle, which beats the
 * registry default. Per-target rules (organization, project, percentage)
 * don't fire here because the listing has no tenant and no bucketing
 * subject, which is also why `flagKey` is optional: with no subject a
 * percentage rule cannot match whatever the key is.
 */
export function resolveEffectiveForListing({
  envOverride,
  rules,
  rowEnabled,
  registryDefault,
  flagKey = "",
}: {
  envOverride: boolean | null;
  rules: FeatureFlagRules;
  rowEnabled: boolean | null;
  registryDefault: boolean;
  flagKey?: string;
}): boolean {
  if (envOverride !== null) return envOverride;
  const ruleHit = evaluateRules(rules, {}, flagKey);
  if (ruleHit !== null) return ruleHit;
  if (rowEnabled !== null) return rowEnabled;
  return registryDefault;
}

function matchesContext(
  match: FeatureFlagRuleMatch,
  ctx: RuleEvaluationContext,
  flagKey: string,
): boolean {
  // Fail closed on unknown match keys: a newer writer might have added a
  // condition this reader does not understand. Treating it as "no
  // constraint" would silently turn that rule into a global match for
  // every context.
  for (const key of Object.keys(match)) {
    if (!KNOWN_MATCH_KEYS.includes(key as KnownMatchKey)) return false;
  }
  // Every specified field must match the context. An entirely empty
  // match acts as a default-rule and matches every context.
  if (match.projectId !== undefined && match.projectId !== ctx.projectId) {
    return false;
  }
  if (match.organizationId !== undefined && match.organizationId !== ctx.organizationId) {
    return false;
  }
  if (
    match.percentage !== undefined &&
    !isWithinRolloutPercentage({
      flagKey,
      subject: ctx.bucketingId,
      percentage: match.percentage,
    })
  ) {
    return false;
  }
  return true;
}
