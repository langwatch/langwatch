import type { ScopeFilterValue } from "@langwatch/authz-browser-kit";
import type { DataPrivacyRule, DataPrivacyScopeAvailable } from "@langwatch/data-privacy-contract";

/** Whether a rule sits at the scope the page's filter names. */
export function ruleMatchesScopeFilter({
  rule,
  filter,
  teamId,
  projectId,
}: {
  rule: DataPrivacyRule;
  filter: ScopeFilterValue;
  teamId: string | undefined;
  projectId: string;
}): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "team-current") return rule.scopeType === "TEAM" && rule.scopeId === teamId;
  if (filter.kind === "project-current") {
    return rule.scopeType === "PROJECT" && rule.scopeId === projectId;
  }
  return rule.scopeType === filter.scopeType && rule.scopeId === filter.scopeId;
}

/** A caller may write rules when any scope at all is available to them. */
export function canWritePrivacyRules(available: DataPrivacyScopeAvailable | undefined): boolean {
  return (
    !!available &&
    (!!available.organization ||
      available.departments.length > 0 ||
      available.teams.length > 0 ||
      available.projects.length > 0)
  );
}
