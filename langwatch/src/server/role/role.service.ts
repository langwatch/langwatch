import type { PrismaClient } from "@prisma/client";
import {
  RoleRepository,
  type CreateRoleParams,
  type UpdateRoleParams,
} from "./repositories/role.repository";
import {
  RoleNotFoundError,
  RoleDuplicateNameError,
  RoleInUseError,
  TeamNotFoundError,
  RoleOrganizationMismatchError,
  UserNotTeamMemberError,
} from "./errors";

/**
 * Service layer for custom role management
 * Single Responsibility: Handle business logic for custom roles
 */
export class RoleService {
  private readonly repository: RoleRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new RoleRepository(prisma);
  }

  async getAllRoles(organizationId: string) {
    const roles = await this.repository.findAllByOrganization(organizationId);
    return roles.map((role) => ({
      ...role,
      permissions: role.permissions as string[],
    }));
  }

  async getRoleById(roleId: string) {
    const role = await this.repository.findById(roleId);

    if (!role) {
      throw new RoleNotFoundError();
    }

    return {
      ...role,
      permissions: role.permissions as string[],
    };
  }

  async createRole(params: CreateRoleParams) {
    // Business rule: Check for duplicate names
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
    // Business rule: Verify role exists
    const existing = await this.repository.findById(roleId);
    if (!existing) {
      throw new RoleNotFoundError();
    }

    const updated = await this.repository.update(roleId, params);

    return {
      ...updated,
      permissions: updated.permissions as string[],
    };
  }

  async deleteRole(roleId: string) {
    // Business rule: Check if role is in use
    const role = await this.repository.findByIdWithUsers(roleId);

    if (!role) {
      throw new RoleNotFoundError();
    }

    if (role.assignedUsers.length > 0) {
      throw new RoleInUseError(role.assignedUsers.length);
    }

    await this.repository.delete(roleId);
    return { success: true };
  }

  async assignRoleToUser(userId: string, teamId: string, customRoleId: string) {
    // Business rule: Validate all entities exist and belong together
    const [customRole, team, teamUser] = await Promise.all([
      this.repository.findById(customRoleId),
      this.prisma.team.findUnique({
        where: { id: teamId },
        select: { organizationId: true },
      }),
      this.prisma.teamUser.findUnique({
        where: {
          userId_teamId: {
            userId,
            teamId,
          },
        },
      }),
    ]);

    if (!customRole) {
      throw new RoleNotFoundError("Custom role not found");
    }

    if (!team) {
      throw new TeamNotFoundError();
    }

    if (customRole.organizationId !== team.organizationId) {
      throw new RoleOrganizationMismatchError();
    }

    if (!teamUser) {
      throw new UserNotTeamMemberError();
    }

    await this.repository.assignToUser(userId, teamId, customRoleId);

    return { success: true };
  }

  async removeRoleFromUser(userId: string, teamId: string) {
    await this.repository.removeFromUser(userId, teamId);
    return { success: true };
  }

  /**
   * Get role with assigned users (used for business rule checks)
   */
  async getRoleWithUsers(roleId: string) {
    return this.repository.findByIdWithUsers(roleId);
  }
}
