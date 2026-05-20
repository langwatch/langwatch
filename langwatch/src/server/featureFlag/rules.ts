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

const featureFlagRuleMatchSchema = z
  .object({
    projectId: z.string().optional(),
    organizationId: z.string().optional(),
  })
  // Future-proof: ignore extra fields rather than reject so a newer
  // writer can ship a rule shape the running reader doesn't know yet,
  // and old rows keep deserializing after we extend the schema.
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

function matchesContext(
  match: FeatureFlagRuleMatch,
  ctx: RuleEvaluationContext,
): boolean {
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
