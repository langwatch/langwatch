import { toEpochMs, type Instant } from "@langwatch/time";
import { z } from "zod";

import { isWithinRolloutPercentage } from "./feature-flag-bucketing.ts";

/**
 * Targeting-rule contract for postgres-backed feature flags. Rules are
 * evaluated in order; first match wins, else fall back to row's enabled.
 */

const KNOWN_MATCH_KEYS = [
  "projectId",
  "organizationId",
  "organizationCreatedAfter",
  "percentageRollout",
  "emailDomain",
] as const;
type KnownMatchKey = (typeof KNOWN_MATCH_KEYS)[number];

const featureFlagRuleMatchSchema = z
  .object({
    projectId: z.string().optional(),
    organizationId: z.string().optional(),
    /**
     * "New users": matches organizations created on or after this instant
     * (ISO date string, YYYY-MM-DD).
     */
    organizationCreatedAfter: z.string().optional(),
    /**
     * Whole-percent rollout across the rule's remaining audience. Combined
     * with the other conditions rather than replacing them, so "20% of this
     * organization" is one rule.
     */
    percentageRollout: z.number().optional(),
    /**
     * Team QA in production: matches every signed-in user whose email is at
     * one of these lowercase domains (no `@`), compared exactly against the
     * part after the last `@` of `userEmail`. No user email, no match.
     */
    emailDomain: z.union([z.string(), z.array(z.string())]).optional(),
  })
  // Future-proof: keeps unknown fields rather than rejecting them, so a
  // newer writer's rule shape still deserializes here. The matcher itself
  // fails closed on unknown keys (see matchesContext) — an unrecognized
  // condition never silently matches everything.
  .passthrough();

export const featureFlagRuleSchema = z.object({
  match: featureFlagRuleMatchSchema,
  enabled: z.boolean(),
});

export const featureFlagRulesSchema = z.array(featureFlagRuleSchema);

/**
 * Rules operators can write; narrower set than what we read to prevent dead
 * rules (blank/padded ids or unparseable dates).
 */
export const featureFlagRulesWriteSchema = featureFlagRulesSchema
  .max(50)
  .refine(
    (rules) =>
      rules.every((rule) =>
        [rule.match.projectId, rule.match.organizationId].every(
          (id) => id === undefined || (id.length > 0 && id === id.trim()),
        ),
      ),
    {
      message: "A targeting rule's project/organization id must not be blank or padded",
    },
  )
  .refine(
    (rules) =>
      rules.every(
        (rule) =>
          rule.match.organizationCreatedAfter === undefined ||
          !Number.isNaN(toEpochMs(rule.match.organizationCreatedAfter)),
      ),
    {
      message: "A new-users targeting rule needs a date the organization was created on or after",
    },
  )
  .refine(
    (rules) =>
      rules.every(
        (rule) =>
          rule.match.percentageRollout === undefined ||
          (Number.isFinite(rule.match.percentageRollout) &&
            rule.match.percentageRollout >= 0 &&
            rule.match.percentageRollout <= 100),
      ),
    {
      message: "A percentage rollout rule needs a percentage between 0 and 100",
    },
  )
  .refine(
    (rules) =>
      rules.every((rule) => {
        if (rule.match.emailDomain === undefined) return true;
        const domains = emailDomainsOf(rule.match.emailDomain);
        return domains.length > 0 && domains.every(isWritableEmailDomain);
      }),
    {
      message: "An email domain rule needs one or more lowercase domains without the @",
    },
  );

/** The domains an `emailDomain` condition names, one or several, as a list. */
export function emailDomainsOf(emailDomain: string | string[] | undefined): string[] {
  if (emailDomain === undefined) return [];
  return Array.isArray(emailDomain) ? emailDomain : [emailDomain];
}

/**
 * The stored form of one domain: lowercase, no padding, no `@`, no
 * whitespace. The matcher still reads a padded or capitalised domain, but a
 * canonical row is what the Ops UI reopens and the summary line names.
 */
function isWritableEmailDomain(domain: string): boolean {
  return domain.length > 0 && domain === domain.trim().toLowerCase() && !/[@\s]/.test(domain);
}

export type FeatureFlagRuleMatch = z.infer<typeof featureFlagRuleMatchSchema>;
export type FeatureFlagRule = z.infer<typeof featureFlagRuleSchema>;
export type FeatureFlagRules = z.infer<typeof featureFlagRulesSchema>;

export interface RuleEvaluationContext {
  projectId?: string;
  organizationId?: string;
  /**
   * The stable identity a percentage rule buckets on: the user, or the
   * anonymous browser id when there is no user. Absent for system callers,
   * which never satisfy a percentage rule.
   */
  bucketingId?: string;
  /**
   * When the calling organization was created. Fetched lazily, only when a
   * flag's rules ask for it (`readNeedsOrganizationAge`). Absent means
   * "unknown" — no age rule matches.
   */
  organizationCreatedAt?: Instant | string | null;
  /**
   * The signed-in user's email, for an email domain rule. Absent on every
   * read without a session (a job, an API key, a sign-up), so no domain
   * rule can match there.
   */
  userEmail?: string;
}

/**
 * True when evaluating rules requires knowing organization age; avoids
 * lookup for flags with no age rules.
 */
export function readNeedsOrganizationAge({
  rules,
  ctx,
  flagKey,
}: {
  rules: FeatureFlagRules;
  ctx: RuleEvaluationContext;
  flagKey?: string;
}): boolean {
  for (const rule of rules) {
    const { organizationCreatedAfter, ...rest } = rule.match;
    // Conditions other than the age decide whether this rule is about this
    // context at all, and they are answerable from what the caller passed.
    if (!matchesContext(rest, ctx, flagKey)) continue;
    return organizationCreatedAfter !== undefined;
  }
  return false;
}

/**
 * Parses an unknown rules payload (typically off the JSONB column).
 * Never throws — returns an empty list on null/invalid input, because a
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
export function deriveRuleOutcome(
  rules: FeatureFlagRules,
  ctx: RuleEvaluationContext,
  flagKey = "",
): boolean | null {
  for (const rule of rules) {
    if (matchesContext(rule.match, ctx, flagKey)) return rule.enabled;
  }
  return null;
}

/**
 * Default context effective value for Ops listing UI (no per-target rules
 * since listing has no tenant).
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
  const ruleHit = deriveRuleOutcome(rules, {}, flagKey);
  if (ruleHit !== null) return ruleHit;
  if (rowEnabled !== null) return rowEnabled;
  return registryDefault;
}

function matchesContext(
  match: FeatureFlagRuleMatch,
  ctx: RuleEvaluationContext,
  flagKey = "",
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
    match.percentageRollout !== undefined &&
    !isWithinRolloutPercentage({
      flagKey,
      subject: ctx.bucketingId,
      percentage: match.percentageRollout,
    })
  ) {
    return false;
  }
  if (
    match.organizationCreatedAfter !== undefined &&
    !isOrganizationNewerThan(match.organizationCreatedAfter, ctx.organizationCreatedAt)
  ) {
    return false;
  }
  if (match.emailDomain !== undefined && !isEmailInDomain(match.emailDomain, ctx.userEmail)) {
    return false;
  }
  return true;
}

/**
 * Whether the read's user is at one of the rule's domains, compared
 * lowercase and exact: `acme.com` does not match `eu.acme.com` unless
 * listed. Fails closed on no email and on an email with no `@`.
 */
function isEmailInDomain(emailDomain: string | string[], userEmail: string | undefined): boolean {
  if (!userEmail) return false;
  const at = userEmail.lastIndexOf("@");
  if (at < 0) return false;
  const domain = userEmail
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (domain === "") return false;
  return emailDomainsOf(emailDomain).some((candidate) => candidate.trim().toLowerCase() === domain);
}

/**
 * Inclusive lower bound on organization creation instant; fails closed on
 * unknown or unparseable dates.
 */
function isOrganizationNewerThan(
  createdAfter: string,
  organizationCreatedAt: Instant | string | null | undefined,
): boolean {
  if (organizationCreatedAt == null) return false;
  const boundary = toEpochMs(createdAfter);
  const createdAt =
    typeof organizationCreatedAt === "string"
      ? toEpochMs(organizationCreatedAt)
      : organizationCreatedAt.epochMilliseconds;
  if (Number.isNaN(boundary) || Number.isNaN(createdAt)) return false;
  return createdAt >= boundary;
}
