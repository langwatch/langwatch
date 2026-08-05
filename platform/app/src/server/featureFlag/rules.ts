import { z } from "zod";

/**
 * Targeting-rule contract for postgres-backed feature flags.
 *
 * Rules sit on `FeatureFlag.rules` as a JSON array. The store walks
 * them in order at evaluation time; the first rule whose `match`
 * conditions all hold against the calling context wins. When no rule
 * matches, the row's `enabled` boolean is used as the row-level
 * default. When the row itself is missing, the resolver falls
 * through to PostHog (PRODUCT) or the registry default (SYSTEM).
 *
 * The shape is intentionally open-ended — today it carries `projectId`
 * and `organizationId`, tomorrow it can grow `userEmail`,
 * `percentageRollout`, etc., without a schema migration.
 */

const KNOWN_MATCH_KEYS = ["projectId", "organizationId"] as const;
type KnownMatchKey = (typeof KNOWN_MATCH_KEYS)[number];

const featureFlagRuleMatchSchema = z
  .object({
    projectId: z.string().optional(),
    organizationId: z.string().optional(),
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
): boolean | null {
  for (const rule of rules) {
    if (matchesContext(rule.match, ctx)) return rule.enabled;
  }
  return null;
}

/**
 * Compute the "default context" effective value for the Ops listing
 * UI — what a feature-flag check would resolve to for a caller with no
 * project/organization context. This mirrors the resolver chain so the
 * table can't contradict runtime behavior: env override beats any
 * empty-match rule, which beats the row-level toggle, which beats the
 * registry default. Per-target rules (org/project) don't fire here
 * because the listing has no specific tenant context.
 */
export function resolveEffectiveForListing({
  envOverride,
  rules,
  rowEnabled,
  registryDefault,
}: {
  envOverride: boolean | null;
  rules: FeatureFlagRules;
  rowEnabled: boolean | null;
  registryDefault: boolean;
}): boolean {
  if (envOverride !== null) return envOverride;
  const ruleHit = evaluateRules(rules, {});
  if (ruleHit !== null) return ruleHit;
  if (rowEnabled !== null) return rowEnabled;
  return registryDefault;
}

function matchesContext(
  match: FeatureFlagRuleMatch,
  ctx: RuleEvaluationContext,
): boolean {
  // Fail closed on unknown match keys: a newer writer might have added
  // a condition (e.g. percentageRollout) that this reader doesn't
  // understand. Treating it as "no constraint" would silently turn
  // that rule into a global match for every context.
  for (const key of Object.keys(match)) {
    if (!KNOWN_MATCH_KEYS.includes(key as KnownMatchKey)) return false;
  }
  // Every specified field must match the context. An entirely empty
  // match acts as a default-rule and matches every context.
  if (match.projectId !== undefined && match.projectId !== ctx.projectId) {
    return false;
  }
  if (
    match.organizationId !== undefined &&
    match.organizationId !== ctx.organizationId
  ) {
    return false;
  }
  return true;
}
