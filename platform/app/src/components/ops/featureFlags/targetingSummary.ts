import type { FeatureFlagRules } from "~/server/featureFlag";

/**
 * One line under a flag's toggle saying who a rule has already switched the
 * flag on for, when the toggle itself reads off.
 *
 * The walk honors first-match-wins throughout, because every shortcut around
 * it makes the page contradict the resolver: a disabled rule shadows every
 * later rule for the same target, a rule below a catch-all can never fire,
 * and — since an age rule is an inclusive lower bound rather than an exact
 * value — a disabled "new users since January" shadows an enabled "new users
 * since June" as well.
 *
 * @see specs/ops/internal-feature-flags.feature
 */

export interface TargetingSummary {
  enabledForEveryone: boolean;
  enabledOrganizationCount: number;
  enabledProjectCount: number;
  /** The date of the first "new users" rule that enables the flag. */
  enabledNewUsersSince: string | null;
  /**
   * Targets an earlier rule switches off. Only readable alongside
   * `enabledForEveryone`, where the catch-all would otherwise claim the
   * whole fleet on behalf of organizations a rule above it excludes.
   */
  excludedOrganizationCount: number;
  excludedProjectCount: number;
}

type TargetKey = "organizationId" | "projectId";

export function summarizeTargeting(rules: FeatureFlagRules): TargetingSummary {
  const { reachable, catchAllEnabled } = splitAtCatchAll(rules);
  const organizations = firstDecisionPerTarget({
    rules: reachable,
    key: "organizationId",
  });
  const projects = firstDecisionPerTarget({
    rules: reachable,
    key: "projectId",
  });

  return {
    enabledForEveryone: catchAllEnabled === true,
    enabledOrganizationCount: count({ decisions: organizations, enabled: true }),
    enabledProjectCount: count({ decisions: projects, enabled: true }),
    enabledNewUsersSince: firstUnshadowedEnabledDate(reachable),
    excludedOrganizationCount: count({
      decisions: organizations,
      enabled: false,
    }),
    excludedProjectCount: count({ decisions: projects, enabled: false }),
  };
}

/**
 * The summary as the operator reads it, or null when no rule enables the
 * flag for anyone. Callers render it only while the flag's own toggle is
 * off, where it is the sole hint that the flag is live somewhere.
 */
export function targetingLabel(summary: TargetingSummary): string | null {
  if (summary.enabledForEveryone) {
    const exceptions = join([
      pluralize({ count: summary.excludedOrganizationCount, noun: "organization" }),
      pluralize({ count: summary.excludedProjectCount, noun: "project" }),
    ]);
    return exceptions
      ? `Enabled for everyone via rule, except ${exceptions}`
      : "Enabled for everyone via rule";
  }
  const targets = join([
    pluralize({ count: summary.enabledOrganizationCount, noun: "organization" }),
    pluralize({ count: summary.enabledProjectCount, noun: "project" }),
    summary.enabledNewUsersSince
      ? `organizations created on or after ${formatDate(summary.enabledNewUsersSince)}`
      : null,
  ]);
  return targets ? `Enabled for ${targets}` : null;
}

/**
 * Everything up to the first rule with no conditions at all, which matches
 * every context and makes every rule below it unreachable.
 *
 * "No conditions" is counted, not spelled out as "no organization and no
 * project": an age rule names neither of those and is emphatically not a
 * catch-all, so the shorter test would report the whole fleet for it.
 */
function splitAtCatchAll(rules: FeatureFlagRules): {
  reachable: FeatureFlagRules;
  catchAllEnabled: boolean | null;
} {
  const reachable: FeatureFlagRules = [];
  for (const rule of rules) {
    if (Object.keys(rule.match).length === 0) {
      return { reachable, catchAllEnabled: rule.enabled };
    }
    reachable.push(rule);
  }
  return { reachable, catchAllEnabled: null };
}

/** For each distinct target named under `key`, the first rule's verdict. */
function firstDecisionPerTarget({
  rules,
  key,
}: {
  rules: FeatureFlagRules;
  key: TargetKey;
}): Map<string, boolean> {
  const decisions = new Map<string, boolean>();
  for (const rule of rules) {
    const target = rule.match[key];
    if (!target || decisions.has(target)) continue;
    decisions.set(target, rule.enabled);
  }
  return decisions;
}

/**
 * The date of the first age rule that switches the flag on for anybody.
 *
 * An age rule is a lower bound, not an equality, so an organization matching
 * a later rule matches every earlier rule naming an earlier-or-equal date
 * too. A disabled "since January" therefore answers for every organization a
 * subsequent "since June" would have covered, and the June rule enables
 * nobody — the case a per-date walk reports backwards.
 *
 * Only rules whose sole condition is the date take part. One that also names
 * an organization speaks for that organization alone, so it neither claims
 * the new-users population nor shadows a rule that does.
 */
function firstUnshadowedEnabledDate(rules: FeatureFlagRules): string | null {
  const dated = rules.flatMap((rule) => {
    const date = rule.match.organizationCreatedAfter;
    if (!date || Object.keys(rule.match).length > 1) return [];
    return [{ date, enabled: rule.enabled }];
  });
  const shadows = (earlier: { date: string; enabled: boolean }, date: string) =>
    !earlier.enabled && startsOnOrBefore(earlier.date, date);

  return (
    dated.find(
      (rule, index) =>
        rule.enabled &&
        !dated.slice(0, index).some((earlier) => shadows(earlier, rule.date)),
    )?.date ?? null
  );
}

/**
 * Whether every organization the later date covers is already covered by the
 * earlier one. An unparseable boundary matches nobody in the resolver, so it
 * covers nothing here either and shadows no rule.
 */
function startsOnOrBefore(earlier: string, later: string): boolean {
  const from = Date.parse(earlier);
  const to = Date.parse(later);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return from <= to;
}

function count({
  decisions,
  enabled,
}: {
  decisions: Map<string, boolean>;
  enabled: boolean;
}): number {
  let total = 0;
  for (const decision of decisions.values()) if (decision === enabled) total += 1;
  return total;
}

function join(parts: (string | null)[]): string | null {
  const present = parts.filter((part): part is string => part !== null);
  return present.length === 0 ? null : present.join(", ");
}

function pluralize({
  count,
  noun,
}: {
  count: number;
  noun: string;
}): string | null {
  if (count === 0) return null;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Rendered in UTC on purpose: the stored value is a calendar day, and
 * formatting it in the operator's own zone shows the day before it west of
 * Greenwich — which would make the page disagree with the date the operator
 * typed into the rule.
 */
function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleDateString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
