import type { Prisma, PrismaClient } from "@prisma/client";
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
  CUSTOM_ROLE_KIND,
  type CreateRoleParams,
  RoleRepository,
  type UpdateRoleParams,
} from "./repositories/role.repository";

export class RoleService {
  private readonly repository: RoleRepository;

  constructor(prisma: PrismaClient | Prisma.TransactionClient) {
    this.repository = new RoleRepository(prisma);
  }

  async getAllRoles(organizationId: string) {
    const roles = await this.repository.findUserCreatedByOrganization(organizationId);
    return roles.map((role) => ({
      ...role,
      permissions: role.permissions as string[],
    }));
  }

  async getRoleById(roleId: string) {
    const role = await this.repository.findById(roleId);

    if (!role || role.kind !== CUSTOM_ROLE_KIND.CUSTOM) {
      throw new RoleNotFoundError();
    }

    return {
      ...role,
      permissions: role.permissions as string[],
    };
  }

  async getRoleByIdOrNull(roleId: string) {
    const role = await this.repository.findById(roleId);
    if (!role || role.kind !== CUSTOM_ROLE_KIND.CUSTOM) return null;
    return { ...role, permissions: role.permissions as string[] };
  }

  async createRole(params: CreateRoleParams) {
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

    const role = await this.repository.create(params);

    return {
      ...role,
      permissions: role.permissions as string[],
    };
  }

  async updateRole(roleId: string, params: UpdateRoleParams) {
    if (params.name?.startsWith("apikey:")) {
      throw new RoleReservedNameError();
    }

    const existing = await this.repository.findById(roleId);
    if (!existing || existing.kind !== CUSTOM_ROLE_KIND.CUSTOM) {
      throw new RoleNotFoundError();
    }

    const updated = await this.repository.update(roleId, params);

    return {
      ...updated,
      permissions: updated.permissions as string[],
    };
  }

  async deleteRole(roleId: string) {
    const role = await this.repository.findByIdWithUsers(roleId);

    if (!role || role.kind !== CUSTOM_ROLE_KIND.CUSTOM) {
      throw new RoleNotFoundError();
    }

    if (role.assignedUsers.length > 0) {
      throw new RoleInUseError(role.assignedUsers.length);
    }

    await this.repository.delete(roleId);
    return { success: true };
  }

  async assignRoleToUser(userId: string, teamId: string, customRoleId: string) {
    const [customRole, team] = await Promise.all([
      this.repository.findById(customRoleId),
      this.repository.findTeamById(teamId),
    ]);

    if (!customRole || customRole.kind !== CUSTOM_ROLE_KIND.CUSTOM) {
      throw new RoleNotFoundError("Custom role not found");
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

    await this.repository.assignToUser(userId, teamId, customRoleId);

    return { success: true };
  }

  async removeRoleFromUser(userId: string, teamId: string) {
    await this.repository.removeFromUser(userId, teamId);
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
    return this.repository.findUserCustomRoleBinding({ userId, organizationId, teamId });
  }

  async validateRolesAssignable({
    roleIds,
    organizationId,
  }: {
    roleIds: string[];
    organizationId: string;
  }) {
    if (roleIds.length === 0) return;

    const validRoles = await this.repository.findAssignableByIds(roleIds, organizationId);
    const validIds = new Set(validRoles.map((r) => r.id));
    const invalid = roleIds.filter((id) => !validIds.has(id));

    if (invalid.length > 0) {
      throw new RoleNotAssignableError();
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
    const validRoles = await this.repository.findAssignableByIds(roleIds, organizationId);
    return validRoles.map((r) => r.id);
  }
}
