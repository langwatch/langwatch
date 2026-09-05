import { z } from "zod";

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
 * `organizationId`, `organizationCreatedAfter` and `percentageRollout`,
 * tomorrow it can grow `userEmail`, etc., without a schema migration.
 */

const KNOWN_MATCH_KEYS = [
  "projectId",
  "organizationId",
  "organizationCreatedAfter",
  "percentageRollout",
] as const;
type KnownMatchKey = (typeof KNOWN_MATCH_KEYS)[number];

const featureFlagRuleMatchSchema = z
  .object({
    projectId: z.string().optional(),
    organizationId: z.string().optional(),
    /**
     * "New users": matches every organization created on or after this
     * instant, and nobody else. An operator rolling a feature out to new
     * signups cannot write the ids of organizations that do not exist yet,
     * so this names one date instead and every later signup matches it
     * without another edit. Held as a string (an ISO date, `YYYY-MM-DD` from
     * the Ops UI's date field) because rules live in a JSONB column, where a
     * Date would round-trip as a string anyway.
     */
    organizationCreatedAfter: z.string().optional(),
    /**
     * A/B split: matches the share of callers, in percent, whose rollout
     * bucket falls below this number. The bucket is a stable hash of the
     * flag key and the read's `distinctId`, so one user keeps the same
     * answer on every read of one flag while landing in different buckets
     * for different flags. A read without a `distinctId` never matches.
     */
    percentageRollout: z.number().optional(),
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

/**
 * The rules an operator is allowed to WRITE, which is a narrower set than the
 * rules we are willing to READ.
 *
 * `parseRules` must keep accepting whatever is already stored — a row written
 * by a newer version, a row written by hand — so these refinements deliberately
 * do not live on the shared schema. What they catch is a rule that cannot
 * match anything and therefore silently does nothing: matching is exact string
 * equality, so a blank or padded id is a dead rule; comparison is by instant,
 * so is a date that cannot be parsed. Either one leaves an operator watching a
 * rollout that never starts.
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
      message:
        "A targeting rule's project/organization id must not be blank or padded",
    },
  )
  .refine(
    (rules) =>
      rules.every(
        (rule) =>
          rule.match.organizationCreatedAfter === undefined ||
          !Number.isNaN(Date.parse(rule.match.organizationCreatedAfter)),
      ),
    {
      message:
        "A new-users targeting rule needs a date the organization was created on or after",
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
      message:
        "A percentage rollout rule needs a percentage between 0 and 100",
    },
  );

export type FeatureFlagRuleMatch = z.infer<typeof featureFlagRuleMatchSchema>;
export type FeatureFlagRule = z.infer<typeof featureFlagRuleSchema>;
export type FeatureFlagRules = z.infer<typeof featureFlagRulesSchema>;

export interface RuleEvaluationContext {
  projectId?: string;
  organizationId?: string;
  /**
   * When the calling organization was created. Only an age rule
   * (`organizationCreatedAfter`) reads it, so callers leave it out and the
   * store fetches it lazily — and only for a flag whose rules ask for it
   * (see `readNeedsOrganizationAge`). Absent means "unknown", which no age
   * rule matches.
   */
  organizationCreatedAt?: Date | string | null;
  /**
   * Who is asking, for a percentage rollout: the user id on a frontend read.
   * Absent means no percentage rule can match, so an organization-scoped or
   * project-scoped read with no caller identity is never split.
   */
  distinctId?: string;
  /**
   * The flag being read, salted into the rollout bucket so one user is not
   * in the same half of every experiment. Absent means no percentage rule
   * can match.
   */
  flagKey?: string;
}

/** Buckets in a percentage rollout: a bucket is an integer in [0, 100). */
const ROLLOUT_BUCKETS = 100;

/**
 * The stable bucket of one caller for one flag: fnv1a over
 * `${flagKey}:${distinctId}`, reduced to [0, 100). Deterministic across
 * processes and deploys, with no dependency on a crypto module, so the
 * matcher stays synchronous and the same user reads the same answer from
 * every pod.
 */
export function rolloutBucket({
  flagKey,
  distinctId,
}: {
  flagKey: string;
  distinctId: string;
}): number {
  return fnv1a32(`${flagKey}:${distinctId}`) % ROLLOUT_BUCKETS;
}

/** 32-bit FNV-1a over the UTF-16 code units of `input`. */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * True when this read cannot be answered without knowing how old the
 * organization is, which is the store's signal to resolve
 * `organizationCreatedAt` before evaluating. Asked per read so a flag with no
 * age rule — every kill switch on the per-event hot path — never pays for an
 * organization lookup.
 *
 * The question is about this context, not about the rule list: rules are
 * first-match-wins, so the first rule that can match here also settles the
 * flag here. A rule naming another organization is skipped, and one that
 * matches on conditions the store already holds answers without a date — an
 * age rule below either of those never gets a say, and reading a date for it
 * would put a query on the path of every previously unseen organization to
 * no end.
 */
export function readNeedsOrganizationAge({
  rules,
  ctx,
}: {
  rules: FeatureFlagRules;
  ctx: RuleEvaluationContext;
}): boolean {
  for (const rule of rules) {
    const { organizationCreatedAfter, ...rest } = rule.match;
    // Conditions other than the age decide whether this rule is about this
    // context at all, and they are answerable from what the caller passed.
    if (!matchesContext(rest, ctx)) continue;
    return organizationCreatedAfter !== undefined;
  }
  return false;
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
  if (
    match.organizationCreatedAfter !== undefined &&
    !isOrganizationNewerThan(
      match.organizationCreatedAfter,
      ctx.organizationCreatedAt,
    )
  ) {
    return false;
  }
  if (
    match.percentageRollout !== undefined &&
    !isInRollout(match.percentageRollout, ctx)
  ) {
    return false;
  }
  return true;
}

/**
 * Whether this read falls inside the rolled-out share. Fails closed on a
 * read that carries no caller identity or no flag key, and on a percentage
 * that cannot be read as a number, for the same reason the age rule does: a
 * condition the matcher cannot evaluate must not become no condition.
 */
function isInRollout(
  percentageRollout: number,
  ctx: RuleEvaluationContext,
): boolean {
  if (!ctx.distinctId || !ctx.flagKey) return false;
  if (!Number.isFinite(percentageRollout)) return false;
  return (
    rolloutBucket({ flagKey: ctx.flagKey, distinctId: ctx.distinctId }) <
    percentageRollout
  );
}

/**
 * Inclusive lower bound on the organization's creation instant: an
 * organization created at any point on the named day matches, because an
 * operator picking a date reads it as "from this day on".
 *
 * Fails closed on every input it cannot compare — an unknown creation date
 * (a read that opted the organization scope out, or a lookup that failed)
 * and an unparseable boundary both return false. The alternative, treating
 * an unreadable condition as no condition, turns one bad rule into a
 * fleet-wide switch.
 */
function isOrganizationNewerThan(
  createdAfter: string,
  organizationCreatedAt: Date | string | null | undefined,
): boolean {
  if (organizationCreatedAt == null) return false;
  const boundary = Date.parse(createdAfter);
  const createdAt =
    organizationCreatedAt instanceof Date
      ? organizationCreatedAt.getTime()
      : Date.parse(organizationCreatedAt);
  if (Number.isNaN(boundary) || Number.isNaN(createdAt)) return false;
  return createdAt >= boundary;
}
