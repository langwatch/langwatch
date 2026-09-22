import type { FeatureFlagRules } from "@langwatch/feature-flag-contract";
import { emailDomainsOf } from "@langwatch/feature-flag-contract";
import { toEpochMs } from "@langwatch/time";

import { readableDate } from "./display-formatters.ts";

/**
 * Summary of who a rule switched the flag on for, honoring first-match-wins
 * and age-rule timeline ranges; see specs/ops/internal-feature-flags.feature.
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
  /** The share of users, in percent, the first percentage rule switches on. */
  enabledPercentage: number | null;
  /** The domains the first email domain rule switches on, empty when none. */
  enabledEmailDomains: string[];
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
    enabledPercentage: enabledPercentage(reachable),
    enabledEmailDomains: enabledEmailDomains(reachable),
    excludedOrganizationCount: count({
      decisions: organizations,
      enabled: false,
    }),
    excludedProjectCount: count({ decisions: projects, enabled: false }),
    excludedNewUsers: ages.filter((range) => !range.enabled).flatMap((range) => bare(range) ?? []),
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
    summary.enabledPercentage !== null ? `${summary.enabledPercentage}% of users` : null,
    summary.enabledEmailDomains.length > 0
      ? `users at ${summary.enabledEmailDomains.join(", ")}`
      : null,
  ]);
  return targets ? `Enabled for ${targets}` : null;
}

/**
 * The share the first percentage rule switches on, or null. Only a rule
 * whose sole condition is the percentage counts: one that also names an
 * organization speaks for that organization's users alone.
 */
function enabledPercentage(rules: FeatureFlagRules): number | null {
  for (const rule of rules) {
    const percentage = rule.match.percentage;
    if (percentage === undefined || Object.keys(rule.match).length > 1) continue;
    return rule.enabled ? percentage : null;
  }
  return null;
}

/**
 * The domains the first email domain rule switches on, or none. As with the
 * percentage, only a rule whose sole condition is the domain counts.
 */
function enabledEmailDomains(rules: FeatureFlagRules): string[] {
  for (const rule of rules) {
    if (rule.match.emailDomain === undefined || Object.keys(rule.match).length > 1) continue;
    return rule.enabled ? emailDomainsOf(rule.match.emailDomain) : [];
  }
  return [];
}

/**
 * Everything up to the first rule with no conditions — it matches every
 * context, so every rule below it is unreachable. Counted rather than
 * spelled out, since an age rule names no org/project yet isn't a catch-all.
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
 * Creation dates the age rules decide as ranges, one organization per
 * boundary; only pure-date rules participate.
 */
function ageRanges(rules: FeatureFlagRules): DecidedRange[] {
  const dated = rules.flatMap((rule) => {
    const date = rule.match.organizationCreatedAfter;
    // An unreadable date matches nobody in the resolver, so it decides
    // nothing here either and does not get to bound a range.
    const isBoundingDate = !!date && Object.keys(rule.match).length <= 1 && readable(date);
    if (!isBoundingDate) {
      return [];
    }
    return [{ date, enabled: rule.enabled }];
  });
  const boundaries = [...new Set(dated.map((rule) => rule.date))].toSorted(
    (a, b) => toEpochMs(a) - toEpochMs(b),
  );

  const ranges: DecidedRange[] = [];
  boundaries.forEach((from, index) => {
    const decided = dated.find((rule) => toEpochMs(rule.date) <= toEpochMs(from));
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
  return !Number.isNaN(toEpochMs(date));
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

function pluralize({ count, noun }: { count: number; noun: string }): string | null {
  if (count === 0) return null;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Rendered in UTC on purpose: the stored value is a calendar day, and the
 * operator's own zone would show the day before it west of Greenwich —
 * disagreeing with the date the operator typed into the rule.
 */
function formatDate(value: string): string {
  const parsed = toEpochMs(value);
  if (Number.isNaN(parsed)) return value;
  return readableDate(parsed).toLocaleDateString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
