// CLI login key scope defaults: mirror widest access held. ADMIN/CUSTOM org collapses to chip;
// others from shared teams + personal project. Falls back to org chip if empty. Moved from
// platform/app; uses ApiKeyScopeSelection (not ScopeTriadEntry) to avoid ui-screen-closure.
import type { ApiKeyScopeSelection } from "./api-key-scope.ts";

export function defaultCliKeyScopes(args: {
  organizationId: string;
  /** The caller's own role bindings in this organization. */
  bindings: Array<{ scopeType: string; scopeId: string; role: string }> | undefined;
  /** Non-personal team ids of the organization, in display order. */
  sharedTeamIds: string[];
  /** The caller's own personal workspace project, when one exists. */
  personalProject: { id: string; teamId: string } | null;
}): ApiKeyScopeSelection[] {
  const bindings = args.bindings ?? [];

  const hasOrgWideBinding = bindings.some(
    (b) =>
      b.scopeType === "ORGANIZATION" &&
      b.scopeId === args.organizationId &&
      (b.role === "ADMIN" || b.role === "CUSTOM"),
  );
  if (hasOrgWideBinding) {
    return [{ scopeType: "ORGANIZATION", scopeId: args.organizationId }];
  }

  const boundTeamIds = new Set(
    bindings.filter((b) => b.scopeType === "TEAM").map((b) => b.scopeId),
  );
  const scopes: ApiKeyScopeSelection[] = args.sharedTeamIds
    .filter((teamId) => boundTeamIds.has(teamId))
    .map((teamId) => ({ scopeType: "TEAM", scopeId: teamId }));

  if (args.personalProject && boundTeamIds.has(args.personalProject.teamId)) {
    scopes.push({ scopeType: "PROJECT", scopeId: args.personalProject.id });
  }
  if (scopes.length > 0) return scopes;

  const hasAnyOrgBinding = bindings.some(
    (b) => b.scopeType === "ORGANIZATION" && b.scopeId === args.organizationId,
  );
  if (hasAnyOrgBinding) {
    return [{ scopeType: "ORGANIZATION", scopeId: args.organizationId }];
  }
  return [];
}
