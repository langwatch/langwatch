import {
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "~/generated/prisma/client";
import { isOrgExclusivePermission, type Permission } from "~/server/api/rbac";
import type { LedgerActor } from "~/server/app-layer/authz/ledger";
import { OrgExclusivePermissionScopeError } from "~/server/role-bindings/errors";
import { assertNoPersonalTeamScope } from "~/server/role-bindings/personal-team-scope";
import {
  RoleDuplicateNameError,
  RoleInUseError,
  RoleNotAssignableError,
  RoleNotFoundError,
  RoleOrganizationMismatchError,
  RoleReservedNameError,
  TeamNotFoundError,
  UserNotTeamMemberError,
} from "./errors";
import {
  type CreateRoleParams,
  RoleRepository,
  type UpdateRoleParams,
} from "./repositories/role.repository";
import { CUSTOM_ROLE_KIND } from "./role-kind";

export class RoleService {
  private readonly repository: RoleRepository;

  private readonly prisma: PrismaClient | Prisma.TransactionClient;

  constructor(prisma: PrismaClient | Prisma.TransactionClient) {
    this.prisma = prisma;
    this.repository = new RoleRepository(prisma);
  }

  async getAllRoles(organizationId: string) {
    const roles =
      await this.repository.findUserCreatedByOrganization(organizationId);
    return roles.map((role) => ({
      ...role,
      permissions: role.permissions as string[],
    }));
  }

  async getRoleById(roleId: string) {
    const role = await this.repository.findById(roleId);

    if (!role || role.kind !== CUSTOM_ROLE_KIND.CUSTOM) {
      throw new RoleNotFoundError(roleId);
    }

    return {
      ...role,
      permissions: role.permissions as string[],
    };
  }

  /**
   * Org-scoped read: a role id from another organization reads as not found.
   *
   * The tRPC router loads the role blind and then re-checks the caller's
   * permission on its organization; the REST surface authenticates as one
   * organization up front, so its lookups must be scoped here rather than
   * trusting a later re-check.
   */
  async getRoleForOrg({
    roleId,
    organizationId,
  }: {
    roleId: string;
    organizationId: string;
  }) {
    const role = await this.repository.findCustomByIdInOrg({
      roleId,
      organizationId,
    });
    if (!role) {
      throw new RoleNotFoundError(roleId);
    }
    return {
      ...role,
      permissions: role.permissions as string[],
    };
  }

  /**
   * Org-scoped update. Also pre-checks a rename against the organization's
   * existing role names so the natural-key conflict is a deterministic
   * refusal rather than a database constraint failure.
   */
  async updateRoleForOrg({
    roleId,
    organizationId,
    params,
    actor,
  }: {
    roleId: string;
    organizationId: string;
    params: UpdateRoleParams;
    actor: LedgerActor;
  }) {
    if (params.name?.startsWith("apikey:")) {
      throw new RoleReservedNameError();
    }

    const existing = await this.repository.findCustomByIdInOrg({
      roleId,
      organizationId,
    });
    if (!existing) {
      throw new RoleNotFoundError(roleId);
    }

    if (params.name && params.name !== existing.name) {
      const collision = await this.repository.findByNameAndOrganization(
        params.name,
        organizationId,
      );
      if (collision) {
        throw new RoleDuplicateNameError();
      }
    }

    const updated = await this.repository.update(roleId, params, { actor });

    return {
      ...updated,
      permissions: updated.permissions as string[],
    };
  }

  /**
   * A role is in use when anything still references it: the legacy
   * `TeamUser.assignedRoleId` rows AND RoleBinding rows. Counting only the
   * legacy side let a bound role reach the storage layer, where the delete
   * died as an unnamed constraint failure instead of this refusal.
   */
  private async assertRoleNotInUse(role: {
    id: string;
    organizationId: string;
    assignedUsers: unknown[];
  }) {
    const bindingCount = await this.repository.countRoleBindings({
      roleId: role.id,
      organizationId: role.organizationId,
    });
    if (role.assignedUsers.length > 0 || bindingCount > 0) {
      throw new RoleInUseError({
        userCount: role.assignedUsers.length,
        bindingCount,
      });
    }
  }

  /**
   * The delete itself, with the in-use condition carried on the statement as
   * the backstop the pre-check cannot be: a grant written between the check
   * and the delete would otherwise be unhooked from the role behind it, and a
   * dangling reference falls back to the built-in permission bag rather than
   * failing, so nobody would see it happen.
   *
   * Nothing deleted has two causes, and they get different answers, settled by
   * re-reading the role rather than by the counts. Something took a reference
   * in between: the role is still standing, and the counts are re-read too so
   * the refusal names what holds it rather than what held it a moment ago. Or
   * a concurrent delete already removed the row, in which case the honest
   * answer is that the role is gone, which is also the stable outcome a
   * repeated delete needs.
   *
   * The counts cannot decide this on their own: the delete's condition spans
   * every organization, while `countRoleBindings` is organization-scoped as
   * the tenancy middleware requires, so a holder elsewhere reads as zero here.
   * Under-reporting how many bindings hold a role is a worse refusal message;
   * reporting "not found" for a role that is still there would be a wrong
   * answer.
   */
  private async deleteRoleRow({
    roleId,
    organizationId,
    actor,
  }: {
    roleId: string;
    organizationId: string;
    actor: LedgerActor;
  }) {
    const deleted = await this.repository.deleteIfUnused({
      roleId,
      organizationId,
      actor,
    });
    if (deleted) return;

    const [stillPresent, userCount, bindingCount] = await Promise.all([
      this.repository.findCustomByIdInOrg({ roleId, organizationId }),
      this.repository.countAssignedUsers(roleId),
      this.repository.countRoleBindings({ roleId, organizationId }),
    ]);
    if (!stillPresent) {
      throw new RoleNotFoundError(roleId);
    }
    throw new RoleInUseError({ userCount, bindingCount });
  }

  /**
   * Org-scoped delete, keeping the RoleBinding-aware in-use check: deleting
   * a role that anything still references would leave those grants dangling.
   */
  async deleteRoleForOrg({
    roleId,
    organizationId,
    actor,
  }: {
    roleId: string;
    organizationId: string;
    actor: LedgerActor;
  }) {
    const role = await this.repository.findByIdWithUsersInOrg({
      roleId,
      organizationId,
    });
    if (!role || role.kind !== CUSTOM_ROLE_KIND.CUSTOM) {
      throw new RoleNotFoundError(roleId);
    }

    await this.assertRoleNotInUse(role);
    await this.deleteRoleRow({ roleId, organizationId, actor });

    return { success: true };
  }

  async getRoleByIdOrNull(roleId: string) {
    const role = await this.repository.findById(roleId);
    if (!role || role.kind !== CUSTOM_ROLE_KIND.CUSTOM) return null;
    return { ...role, permissions: role.permissions as string[] };
  }

  async createRole(
    params: CreateRoleParams,
    { actor }: { actor: LedgerActor },
  ) {
    if (params.name.startsWith("apikey:")) {
      throw new RoleReservedNameError();
    }

    const existing = await this.repository.findByNameAndOrganization(
      params.name,
      params.organizationId,
    );

    if (existing) {
      throw new RoleDuplicateNameError();
    }

    const role = await this.repository.create(params, { actor });

    return {
      ...role,
      permissions: role.permissions as string[],
    };
  }

  async updateRole(
    roleId: string,
    params: UpdateRoleParams,
    { actor }: { actor: LedgerActor },
  ) {
    if (params.name?.startsWith("apikey:")) {
      throw new RoleReservedNameError();
    }

    const existing = await this.repository.findById(roleId);
    if (!existing || existing.kind !== CUSTOM_ROLE_KIND.CUSTOM) {
      throw new RoleNotFoundError(roleId);
    }

    const updated = await this.repository.update(roleId, params, { actor });

    return {
      ...updated,
      permissions: updated.permissions as string[],
    };
  }

  async deleteRole(roleId: string, { actor }: { actor: LedgerActor }) {
    const role = await this.repository.findByIdWithUsers(roleId);

    if (!role || role.kind !== CUSTOM_ROLE_KIND.CUSTOM) {
      throw new RoleNotFoundError(roleId);
    }

    await this.assertRoleNotInUse(role);
    await this.deleteRoleRow({
      roleId,
      organizationId: role.organizationId,
      actor,
    });

    return { success: true };
  }

  async assignRoleToUser(
    userId: string,
    teamId: string,
    customRoleId: string,
    { actor }: { actor: LedgerActor },
  ) {
    const [customRole, team] = await Promise.all([
      this.repository.findById(customRoleId),
      this.repository.findTeamById(teamId),
    ]);

    if (!customRole || customRole.kind !== CUSTOM_ROLE_KIND.CUSTOM) {
      throw new RoleNotFoundError(customRoleId);
    }

    if (!team) {
      throw new TeamNotFoundError();
    }

    if (customRole.organizationId !== team.organizationId) {
      throw new RoleOrganizationMismatchError();
    }

    const binding = await this.repository.findUserTeamBinding({
      userId,
      organizationId: team.organizationId,
      teamId,
    });

    if (!binding) {
      throw new UserNotTeamMemberError();
    }

    await assertNoPersonalTeamScope({
      client: this.prisma,
      scopes: [{ scopeType: RoleBindingScopeType.TEAM, scopeId: teamId }],
    });
    await this.repository.assignToUser(userId, teamId, customRoleId, { actor });

    return { success: true };
  }

  async removeRoleFromUser(
    userId: string,
    teamId: string,
    { actor }: { actor: LedgerActor },
  ) {
    await assertNoPersonalTeamScope({
      client: this.prisma,
      scopes: [{ scopeType: RoleBindingScopeType.TEAM, scopeId: teamId }],
    });
    await this.repository.removeFromUser(userId, teamId, { actor });
    return { success: true };
  }

  async getRoleWithUsers(roleId: string) {
    return this.repository.findByIdWithUsers(roleId);
  }

  async getTeamMembersWithUsers({
    organizationId,
    teamId,
  }: {
    organizationId: string;
    teamId: string;
  }) {
    return this.repository.findTeamMembersWithUsers({ organizationId, teamId });
  }

  async getUserCustomRoleBinding({
    userId,
    organizationId,
    teamId,
  }: {
    userId: string;
    organizationId: string;
    teamId: string;
  }) {
    return this.repository.findUserCustomRoleBinding({
      userId,
      organizationId,
      teamId,
    });
  }

  async validateRolesAssignable({
    roleIds,
    organizationId,
  }: {
    roleIds: string[];
    organizationId: string;
  }) {
    if (roleIds.length === 0) return;

    const validRoles = await this.repository.findAssignableByIds(
      roleIds,
      organizationId,
    );
    const validIds = new Set(validRoles.map((r) => r.id));
    const invalid = roleIds.filter((id) => !validIds.has(id));

    if (invalid.length > 0) {
      throw new RoleNotAssignableError();
    }
  }

  /**
   * A custom role that lists an organization-exclusive permission cannot be
   * bound below organization scope. The read side already refuses to grant
   * such a permission from a team or project binding; accepting the write
   * anyway would store a grant that silently does nothing, which is worse
   * than a refusal, because the admin believes it took effect.
   *
   * Lives here rather than on one write path because every surface that binds
   * a custom role has to apply it: direct role bindings, group bindings, and
   * anything that follows them.
   */
  async assertNoOrgExclusivePermissionsBelowOrgScope({
    organizationId,
    customBindings,
  }: {
    organizationId: string;
    customBindings: Array<{
      customRoleId: string;
      scopeType: RoleBindingScopeType;
    }>;
  }): Promise<void> {
    const belowOrgScope = customBindings.filter(
      (binding) => binding.scopeType !== RoleBindingScopeType.ORGANIZATION,
    );
    if (belowOrgScope.length === 0) return;

    const roles = await this.repository.findAssignablePermissionsByIds(
      [...new Set(belowOrgScope.map((binding) => binding.customRoleId))],
      organizationId,
    );
    const permissionsByRoleId = new Map(
      roles.map((role) => [
        role.id,
        Array.isArray(role.permissions)
          ? role.permissions.filter(
              (permission): permission is string =>
                typeof permission === "string",
            )
          : [],
      ]),
    );

    for (const binding of belowOrgScope) {
      const permissions = permissionsByRoleId.get(binding.customRoleId) ?? [];
      const orgExclusive = permissions.find((permission) =>
        isOrgExclusivePermission(permission as Permission),
      );
      if (orgExclusive) {
        throw new OrgExclusivePermissionScopeError(
          orgExclusive,
          binding.scopeType,
        );
      }
    }
  }

  async filterAssignableRoleIds({
    roleIds,
    organizationId,
  }: {
    roleIds: string[];
    organizationId: string;
  }): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const validRoles = await this.repository.findAssignableByIds(
      roleIds,
      organizationId,
    );
    return validRoles.map((r) => r.id);
  }
}
