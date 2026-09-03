/**
 * The checks every grant write runs before it touches a row.
 *
 * All three answer one question — does this write stay inside the
 * organization it claims to be for? — and all three answer it by reading the
 * grant repository. A binding must already belong to the organization, the
 * scope it points at must sit under that organization, and a custom role must
 * both belong to it and name permissions that exist.
 *
 * The last one is the least obvious and the most important: a custom role
 * carrying a permission string the registry has never heard of would evaluate
 * to a grant of nothing, silently. It is refused at write time so the customer
 * finds out while they are editing the role rather than when somebody cannot
 * open a page.
 */

import {
  GrantValidationError,
  isRegistryPermission,
  type GrantRole,
  type GrantableAuthzScopeRef,
} from "@langwatch/authz-contract";
import type { AuthzGrantRepository } from "../repositories/authz-grant.repository";

export class AuthzGrantGuardsService {
  constructor(private readonly repository: AuthzGrantRepository) {}

  /**
   * Refused as NOT FOUND rather than forbidden. A distinct answer would tell
   * a caller that the id names a real binding in somebody else's
   * organization.
   */
  static bindingNotFound(meta: Record<string, unknown>): GrantValidationError {
    return new GrantValidationError("Role binding not found", meta);
  }

  async assertBindingInOrganization({
    bindingId,
    organizationId,
  }: {
    bindingId: string;
    organizationId: string;
  }): Promise<void> {
    const binding = await this.repository.tryFindBinding({ bindingId });
    if (!binding || binding.organizationId !== organizationId) {
      throw AuthzGrantGuardsService.bindingNotFound({ bindingId });
    }
  }

  async assertScopeBelongsToOrganization({
    where,
    organizationId,
  }: {
    where: GrantableAuthzScopeRef;
    organizationId: string;
  }): Promise<void> {
    if (where.type === "organization") {
      return;
    }

    if (where.type === "team") {
      const team = await this.repository.tryFindTeamOrganization({ teamId: where.id });
      if (team?.organizationId !== organizationId) {
        throw new GrantValidationError("Team is not in this organization", {
          teamId: where.id,
        });
      }

      return;
    }

    const lineage = await this.repository.tryFindProjectLineage({
      projectId: where.id,
    });
    if (lineage?.organizationId !== organizationId || lineage.teamId !== where.teamId) {
      throw new GrantValidationError("Project is not in this scope", {
        projectId: where.id,
      });
    }
  }

  async assertRoleUsable({
    role,
    organizationId,
  }: {
    role: GrantRole;
    organizationId: string;
  }): Promise<void> {
    if (!("customRoleId" in role)) {
      return;
    }

    const { customRoleId } = role;
    const customRole = await this.repository.tryFindCustomRole({ customRoleId });
    if (!customRole || customRole.organizationId !== organizationId) {
      throw new GrantValidationError("Custom role does not belong to this organization", {
        customRoleId,
      });
    }

    const unknownPermissions = Array.isArray(customRole.permissions)
      ? customRole.permissions
          .filter((value) => typeof value !== "string" || !isRegistryPermission(value))
          .map((value) => String(value))
      : [];
    if (unknownPermissions.length > 0) {
      throw new GrantValidationError("Custom role lists permissions that do not exist", {
        customRoleId,
        unknownPermissions,
      });
    }
  }
}
