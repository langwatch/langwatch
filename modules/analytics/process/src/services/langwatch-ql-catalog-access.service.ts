/**
 * Resolves the LangWatchQL catalogue down to what one principal may read at one project: one
 * `canBatchPermissionsByIds` for the permissions grantable at the project or its team, and one
 * `can` at the organization for each organization-only permission. A check that throws refuses.
 * @see specs/lwql/catalogue-grants.feature
 */
import type { LangWatchQLCatalogueAccess } from "@langwatch/analytics-contract";
import {
  permissionGrantTiers,
  type AuthzApi,
  type AuthzPermission,
  type AuthzScopeRef,
} from "@langwatch/authz-contract";

import { cataloguePermissions, type LwqlCatalogue } from "../rules/lwql-catalogue.rules.ts";

/** Who reads: a signed-in user, an API key (bounded by its owner), or the project itself. */
export type LwqlCataloguePrincipal =
  | Readonly<{ type: "user"; id: string }>
  | Readonly<{ type: "apiKey"; id: string }>
  | Readonly<{ type: "project" }>;

type CatalogAccessDependencies = Readonly<{
  authz: Pick<AuthzApi, "can" | "canBatchPermissionsByIds">;
}>;
type ProjectScope = Extract<AuthzScopeRef, { type: "project" }>;
type AskingPrincipal = Exclude<LwqlCataloguePrincipal, { type: "project" }>;

export class LangWatchQLCatalogAccessService {
  static create(dependencies: CatalogAccessDependencies): LangWatchQLCatalogAccessService {
    return new LangWatchQLCatalogAccessService(dependencies);
  }

  private constructor(private readonly dependencies: CatalogAccessDependencies) {}

  /**
   * The catalogue permissions this principal holds at a project; the project itself holds all.
   * A check that throws propagates: the read is refused, never widened (plan D3).
   */
  async resolveAccessibleCatalog({
    principal,
    scope,
    catalog,
  }: {
    principal: LwqlCataloguePrincipal;
    scope: ProjectScope;
    catalog: LwqlCatalogue;
  }): Promise<LangWatchQLCatalogueAccess> {
    const named = cataloguePermissions({ catalog });
    if (principal.type === "project") return { permissions: named };

    const organizationOnly = named.filter((permission) => !isBatchable(permission));
    const [batched, atOrganization] = await Promise.all([
      this.heldInProjectLineage({
        principal,
        scope,
        permissions: named.filter((permission) => isBatchable(permission)),
      }),
      this.heldAtOrganization({ principal, scope, permissions: organizationOnly }),
    ]);
    const held = new Set([...batched, ...atOrganization]);
    return { permissions: named.filter((permission) => held.has(permission)) };
  }

  /** One batch for every permission grantable at the project or its team. */
  private async heldInProjectLineage({
    principal,
    scope,
    permissions,
  }: {
    principal: AskingPrincipal;
    scope: ProjectScope;
    permissions: readonly AuthzPermission[];
  }): Promise<readonly AuthzPermission[]> {
    if (permissions.length === 0) return [];
    const { byPermission } = await this.dependencies.authz.canBatchPermissionsByIds({
      principal,
      permissions,
      organizationId: scope.organizationId,
      teams: [{ teamId: scope.teamId }],
      projects: [{ projectId: scope.id, teamId: scope.teamId }],
    });
    return permissions.filter((permission) => {
      const decision = byPermission.get(permission);
      return permissionGrantTiers(permission).includes("project")
        ? decision?.projects.get(scope.id) === true
        : decision?.teams.get(scope.teamId) === true;
    });
  }

  /** An organization-only permission, asked at the project's organization; the batch has no org. */
  private async heldAtOrganization({
    principal,
    scope,
    permissions,
  }: {
    principal: AskingPrincipal;
    scope: ProjectScope;
    permissions: readonly AuthzPermission[];
  }): Promise<readonly AuthzPermission[]> {
    const organization: AuthzScopeRef = { type: "organization", id: scope.organizationId };
    const decisions = await Promise.all(
      permissions.map((permission) =>
        this.dependencies.authz.can({ principal, permission, scope: organization }),
      ),
    );
    return permissions.filter((_, index) => decisions[index] === true);
  }
}

/** Whether the permission is grantable at the project or its team, which the batch decides. */
function isBatchable(permission: AuthzPermission): boolean {
  const tiers = permissionGrantTiers(permission);
  return tiers.includes("project") || tiers.includes("team");
}
