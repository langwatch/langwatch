import type { FeatureFlagRules } from "~/server/featureFlag";

/**
 * One line under a flag's toggle saying who a rule has already switched the
 * flag on for, when the toggle itself reads off.
 *
 * The walk honors first-match-wins throughout, because every shortcut around
 * it makes the page contradict the resolver: a disabled rule shadows every
 * later rule for the same target, and a rule below a catch-all can never
 * fire.
 *
 * Age rules need more than a shadow check. Each is an inclusive lower bound,
 * so two of them carve the timeline into ranges rather than naming two
 * independent groups: a rule disabling "since June" placed above one enabling
 * "since January" leaves the flag on for January through May and off from
 * June, and a summary that reports the January rule's date on its own claims
 * a population the resolver switches off.
 *
 * @see specs/ops/internal-feature-flags.feature
 */

/** Organizations created from `from` on, and — when set — before `until`. */
export interface AgeRange {
  from: string;
  until: string | null;
}

export interface TargetingSummary {
  enabledForEveryone: boolean;
  enabledOrganizationCount: number;
  enabledProjectCount: number;
  /** The first stretch of creation dates a rule switches the flag on for. */
  enabledNewUsers: AgeRange | null;
  /**
   * Targets an earlier rule switches off. Only read alongside
   * `enabledForEveryone`, where the catch-all would otherwise claim the whole
   * fleet on behalf of organizations a rule above it excludes.
   */
  excludedOrganizationCount: number;
  excludedProjectCount: number;
  excludedNewUsers: AgeRange[];
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
  const ages = ageRanges(reachable);

  return {
    enabledForEveryone: catchAllEnabled === true,
    enabledOrganizationCount: count({
      decisions: organizations,
      enabled: true,
    }),
    enabledProjectCount: count({ decisions: projects, enabled: true }),
    enabledNewUsers: bare(ages.find((range) => range.enabled)),
    excludedOrganizationCount: count({
      decisions: organizations,
      enabled: false,
    }),
    excludedProjectCount: count({ decisions: projects, enabled: false }),
    excludedNewUsers: ages
      .filter((range) => !range.enabled)
      .flatMap((range) => bare(range) ?? []),
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
      pluralize({
        count: summary.excludedOrganizationCount,
        noun: "organization",
      }),
      pluralize({ count: summary.excludedProjectCount, noun: "project" }),
      ...summary.excludedNewUsers.map(describeRange),
    ]);
    return exceptions
      ? `Enabled for everyone via rule, except ${exceptions}`
      : "Enabled for everyone via rule";
  }
  const targets = join([
    pluralize({
      count: summary.enabledOrganizationCount,
      noun: "organization",
    }),
    pluralize({ count: summary.enabledProjectCount, noun: "project" }),
    summary.enabledNewUsers ? describeRange(summary.enabledNewUsers) : null,
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

interface DecidedRange extends AgeRange {
  enabled: boolean;
}

/**
 * The creation dates the age rules decide, in order, as ranges.
 *
 * Every age condition is `created >= date`, so the verdict can only change at
 * a date some rule names: between two consecutive dates the same rule wins
 * for every organization. Resolving one organization per boundary therefore
 * describes the whole timeline exactly, and adjacent boundaries that agree
 * are merged so a run of rules reads as the one range it is.
 *
 * Only rules whose sole condition is the date take part. One that also names
 * an organization speaks for that organization alone, so it neither claims
 * the new-users population nor excludes any of it.
 */
function ageRanges(rules: FeatureFlagRules): DecidedRange[] {
  const dated = rules.flatMap((rule) => {
    const date = rule.match.organizationCreatedAfter;
    // An unreadable date matches nobody in the resolver, so it decides
    // nothing here either and does not get to bound a range.
    if (!date || Object.keys(rule.match).length > 1 || !readable(date)) {
      return [];
    }
    return [{ date, enabled: rule.enabled }];
  });
  const boundaries = [...new Set(dated.map((rule) => rule.date))].sort(
    (a, b) => Date.parse(a) - Date.parse(b),
  );

  const ranges: DecidedRange[] = [];
  boundaries.forEach((from, index) => {
    const decided = dated.find(
      (rule) => Date.parse(rule.date) <= Date.parse(from),
    );
    if (!decided) return;
    const until = boundaries[index + 1] ?? null;
    const previous = ranges[ranges.length - 1];
    if (previous?.enabled === decided.enabled && previous.until === from) {
      previous.until = until;
      return;
    }
    ranges.push({ from, until, enabled: decided.enabled });
  });
  return ranges;
}

/** A range without the verdict that produced it, which is not the caller's. */
function bare(range: DecidedRange | undefined): AgeRange | null {
  return range ? { from: range.from, until: range.until } : null;
}

function readable(date: string): boolean {
  return !Number.isNaN(Date.parse(date));
}

function describeRange({ from, until }: AgeRange): string {
  const opening = `organizations created on or after ${formatDate(from)}`;
  return until ? `${opening} and before ${formatDate(until)}` : opening;
}

function count({
  decisions,
  enabled,
}: {
  decisions: Map<string, boolean>;
  enabled: boolean;
}): number {
  let total = 0;
  for (const decision of decisions.values()) {
    if (decision === enabled) total += 1;
  }
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
