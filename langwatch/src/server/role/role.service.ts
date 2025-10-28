import { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { RoleRepository } from "./repositories/role.repository";

export type CreateRoleParams = {
  organizationId: string;
  name: string;
  description?: string | null;
  permissions: string[];
};

export type UpdateRoleParams = {
  name?: string;
  description?: string | null;
  permissions?: string[];
};

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
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Role not found",
      });
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
      throw new TRPCError({
        code: "CONFLICT",
        message: "A role with this name already exists",
      });
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
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Role not found",
      });
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
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Role not found",
      });
    }

    if (role.assignedUsers.length > 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Cannot delete role that is assigned to ${role.assignedUsers.length} user(s)`,
      });
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
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Custom role not found",
      });
    }

    if (!team) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Team not found",
      });
    }

    if (customRole.organizationId !== team.organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Custom role does not belong to team's organization",
      });
    }

    if (!teamUser) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User is not a member of the specified team",
      });
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
