import type { FeatureFlagRules } from "~/server/featureFlag";

/**
 * One line under a flag's toggle saying who a rule has already switched the
 * flag on for, when the toggle itself reads off.
 *
 * The walk honors first-match-wins, so a disabled rule shadows every later
 * rule for the same target: reporting "enabled for 3 organizations" when the
 * first rule turns them all off would have the page contradict the resolver.
 *
 * @see specs/ops/internal-feature-flags.feature
 */

export interface TargetingSummary {
  enabledForEveryone: boolean;
  enabledOrganizationCount: number;
  enabledProjectCount: number;
  /** The date of the first "new users" rule that enables the flag. */
  enabledNewUsersSince: string | null;
}

type TargetKey = "organizationId" | "projectId" | "organizationCreatedAfter";

export function summarizeTargeting(rules: FeatureFlagRules): TargetingSummary {
  const { reachable, catchAll } = splitAtCatchAll(rules);

  return {
    enabledForEveryone: catchAll === true,
    enabledOrganizationCount: countEnabled(
      firstDecisionPerTarget(reachable, "organizationId"),
    ),
    enabledProjectCount: countEnabled(
      firstDecisionPerTarget(reachable, "projectId"),
    ),
    enabledNewUsersSince: firstEnabledTarget(
      firstDecisionPerTarget(reachable, "organizationCreatedAfter"),
    ),
  };
}

/**
 * The summary as the operator reads it, or null when no rule enables the
 * flag for anyone. Callers render it only while the flag's own toggle is
 * off, where it is the sole hint that the flag is live somewhere.
 */
export function targetingLabel(summary: TargetingSummary): string | null {
  if (summary.enabledForEveryone) return "Enabled for everyone via rule";
  const targets = [
    pluralize(summary.enabledOrganizationCount, "organization"),
    pluralize(summary.enabledProjectCount, "project"),
    summary.enabledNewUsersSince
      ? `organizations created on or after ${formatDate(summary.enabledNewUsersSince)}`
      : null,
  ].filter((part): part is string => part !== null);
  if (targets.length === 0) return null;
  return `Enabled for ${targets.join(", ")}`;
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
  catchAll: boolean | null;
} {
  const reachable: FeatureFlagRules = [];
  for (const rule of rules) {
    if (Object.keys(rule.match).length === 0) {
      return { reachable, catchAll: rule.enabled };
    }
    reachable.push(rule);
  }
  return { reachable, catchAll: null };
}

/** For each distinct target named under `key`, the first rule's verdict. */
function firstDecisionPerTarget(
  rules: FeatureFlagRules,
  key: TargetKey,
): Map<string, boolean> {
  const decisions = new Map<string, boolean>();
  for (const rule of rules) {
    const target = rule.match[key];
    if (!target || decisions.has(target)) continue;
    decisions.set(target, rule.enabled);
  }
  return decisions;
}

function countEnabled(decisions: Map<string, boolean>): number {
  let count = 0;
  for (const enabled of decisions.values()) if (enabled) count += 1;
  return count;
}

function firstEnabledTarget(decisions: Map<string, boolean>): string | null {
  for (const [target, enabled] of decisions) if (enabled) return target;
  return null;
}

function pluralize(count: number, noun: string): string | null {
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
