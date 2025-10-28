import { type PrismaClient, type CustomRole } from "@prisma/client";

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
 * Repository for custom role data access
 * Single Responsibility: Handle all database operations for CustomRole
 */
export class RoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAllByOrganization(organizationId: string): Promise<CustomRole[]> {
    return this.prisma.customRole.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(roleId: string): Promise<CustomRole | null> {
    return this.prisma.customRole.findUnique({
      where: { id: roleId },
    });
  }

  async findByIdWithUsers(roleId: string) {
    return this.prisma.customRole.findUnique({
      where: { id: roleId },
      include: { assignedUsers: true },
    });
  }

  async findByNameAndOrganization(
    name: string,
    organizationId: string,
  ): Promise<CustomRole | null> {
    return this.prisma.customRole.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name,
        },
      },
    });
  }

  async create(params: CreateRoleParams): Promise<CustomRole> {
    return this.prisma.customRole.create({
      data: {
        organizationId: params.organizationId,
        name: params.name,
        description: params.description,
        permissions: params.permissions,
      },
    });
  }

  async update(roleId: string, params: UpdateRoleParams): Promise<CustomRole> {
    return this.prisma.customRole.update({
      where: { id: roleId },
      data: {
        name: params.name,
        description: params.description,
        permissions: params.permissions,
      },
    });
  }

  async delete(roleId: string): Promise<void> {
    await this.prisma.customRole.delete({
      where: { id: roleId },
    });
  }

  async assignToUser(
    userId: string,
    teamId: string,
    customRoleId: string,
  ): Promise<void> {
    await this.prisma.teamUser.update({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
      data: { assignedRoleId: customRoleId },
    });
  }

  async removeFromUser(userId: string, teamId: string): Promise<void> {
    await this.prisma.teamUser.update({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
      data: { assignedRoleId: null },
    });
  }
}
