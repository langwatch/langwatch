import type {
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  ResourceGrant,
} from "@langwatch/authz";

export const ORG = "org-1";
export const TEAM = "team-1";
export const PROJECT = "proj-1";

export const traceScope = (
  partial: Partial<Extract<AuthzScopeRef, { type: "resource" }>> = {},
): AuthzScopeRef => ({
  type: "resource",
  kind: "trace",
  id: "trace-1",
  projectId: PROJECT,
  teamId: TEAM,
  organizationId: ORG,
  ...partial,
});

export const grantOn = (
  partial: Partial<ResourceGrant> = {},
): ResourceGrant => ({
  kind: "trace",
  id: "trace-1",
  projectId: PROJECT,
  permission: "traces:view",
  audience: { kind: "anyone" },
  ...partial,
});

export function makeGrants({
  bindings = [] as CollectedBinding[],
  organizationId = ORG,
  organizationRole = null as CollectedGrants["organizationRole"],
  isOrgMember = organizationRole != null,
  legacyTeamMemberships = [] as CollectedGrants["legacyTeamMemberships"],
  customRolePermissions = new Map<string, readonly string[]>(),
  principal = { type: "anonymous" } as CollectedGrants["principal"],
}: Partial<CollectedGrants> = {}): CollectedGrants {
  return {
    principal,
    organizationId,
    organizationRole,
    isOrgMember,
    bindings,
    legacyTeamMemberships,
    customRolePermissions,
  };
}

export const binding = (
  partial: Partial<CollectedBinding> &
    Pick<CollectedBinding, "scopeType" | "scopeId">,
): CollectedBinding => ({
  role: "MEMBER",
  customRoleId: null,
  viaGroupId: null,
  ...partial,
});

/** A live ADR-057 ShareLink row: public, unexpired, unlimited views. */
export const liveShareLinkRow = {
  resourceType: "TRACE" as const,
  resourceId: "trace-1",
  projectId: PROJECT,
  visibility: "PUBLIC" as const,
  expiresAt: null,
  maxViews: null,
  viewCount: 0,
};
