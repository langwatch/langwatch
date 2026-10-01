import type { LangWatchQLCatalogueAccess } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzPermission } from "@langwatch/authorization";
import type { AuthzApi, AuthzPrincipalRef, AuthzScopeRef } from "@langwatch/authz-contract";

import { EVERY_CATALOGUE_PERMISSION } from "../../app/__tests__/analytics.fixture.ts";

/** Every permission the catalogue names: a caller who reads every table and column. */
export { EVERY_CATALOGUE_PERMISSION };

/** A caller who holds none of them. */
export const NO_CATALOGUE_PERMISSION: LangWatchQLCatalogueAccess = { permissions: [] };

/** Every catalogue permission but these. */
export function catalogueWithout(
  ...withheld: readonly AuthzPermission[]
): LangWatchQLCatalogueAccess {
  return {
    permissions: EVERY_CATALOGUE_PERMISSION.permissions.filter((p) => !withheld.includes(p)),
  };
}

export type AuthzCheck = Readonly<{
  principal: AuthzPrincipalRef;
  permission: AuthzPermission;
  scope: AuthzScopeRef;
}>;

export const PROJECT_SCOPE = {
  type: "project",
  id: "project-1",
  teamId: "team-1",
  organizationId: "org-1",
} as const;

/**
 * An authz double deciding every catalogue check through `grants`, recording each one. Both the
 * batch and the single check go through it, so a test names permissions, not transports.
 */
export function authzGranting({
  grants,
  groupIds = [],
  scope = PROJECT_SCOPE,
  overrides = {},
}: {
  grants: (check: AuthzCheck) => boolean;
  groupIds?: readonly string[];
  scope?: AuthzScopeRef;
  /** Operations that answer otherwise, such as a read that throws. */
  overrides?: Partial<AuthzApi>;
}): Readonly<{ authz: AuthzApi; checks: AuthzCheck[]; batches: AuthzPermission[][] }> {
  const checks: AuthzCheck[] = [];
  const batches: AuthzPermission[][] = [];
  const decide = (check: AuthzCheck): boolean => {
    checks.push(check);
    return grants(check);
  };
  const decisionsAt = (
    principal: AuthzPrincipalRef,
    permission: AuthzPermission,
    at: readonly AuthzScopeRef[],
  ): Map<string, boolean> =>
    new Map(at.map((where) => [where.id, decide({ principal, permission, scope: where })]));
  const authz = createApiFixture<AuthzApi>(
    {
      getScope: async () => scope,
      can: async ({ principal, permission, scope: at }) =>
        decide({ principal, permission, scope: at }),
      canBatchPermissionsByIds: async ({
        principal,
        permissions,
        organizationId,
        teams,
        projects,
      }) => {
        batches.push([...permissions]);
        const teamScopes = teams.map(({ teamId }): AuthzScopeRef => {
          return { type: "team", id: teamId, organizationId };
        });
        const projectScopes = projects.map(({ projectId, teamId = "" }): AuthzScopeRef => {
          return { type: "project", id: projectId, teamId, organizationId };
        });
        return {
          organizationRole: null,
          byPermission: new Map(
            permissions.map((permission) => [
              permission,
              {
                teams: decisionsAt(principal, permission, teamScopes),
                projects: decisionsAt(principal, permission, projectScopes),
              },
            ]),
          ),
        };
      },
      hasPermission: async ({ userId, permission }) =>
        decide({ principal: { type: "user", id: userId }, permission, scope }),
      getAccessBreakdown: async ({ userId }) => ({
        user: { id: userId, name: null, email: null, orgRole: "MEMBER", orgRolePermissions: [] },
        groups: groupIds.map((id) => ({ id, name: id, slug: id, scimSource: null, bindings: [] })),
        directBindings: [],
      }),
      ...overrides,
    },
    "catalogue authz",
  );
  return { authz, checks, batches };
}
