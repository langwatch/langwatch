import {
  type PrismaClient,
  type CustomRole,
  type Prisma,
  TeamUserRole,
} from "@prisma/client";

/**
 * Derives create params from Prisma schema, omitting auto-generated fields
 */
export type CreateRoleParams = Omit<
  Prisma.CustomRoleUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt"
>;

/**
 * Derives update params from Prisma schema for selective field updates
 */
export type UpdateRoleParams = Partial<
  Pick<CustomRole, "name" | "description" | "permissions">
>;

/**
 * Repository for custom role data access
 * Single Responsibility: Handle all database operations for CustomRole
 */
export class RoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAllByOrganization(organizationId: string) {
    return this.prisma.customRole.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(roleId: string) {
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

  async findByNameAndOrganization(name: string, organizationId: string) {
    return this.prisma.customRole.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name,
        },
      },
    });
  }

  async create(params: CreateRoleParams) {
    return this.prisma.customRole.create({
      data: {
        organizationId: params.organizationId,
        name: params.name,
        description: params.description,
        permissions: params.permissions,
      },
    });
  }

  async update(roleId: string, params: UpdateRoleParams) {
    return this.prisma.customRole.update({
      where: { id: roleId },
      data: {
        name: params.name,
        description: params.description,
        permissions: params.permissions as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async delete(roleId: string) {
    await this.prisma.customRole.delete({
      where: { id: roleId },
    });
  }

  async assignToUser(userId: string, teamId: string, customRoleId: string) {
    await this.prisma.teamUser.update({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
      data: {
        role: TeamUserRole.CUSTOM,
        assignedRoleId: customRoleId,
      },
    });
  }

  async removeFromUser(userId: string, teamId: string) {
    await this.prisma.teamUser.update({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
      data: {
        role: TeamUserRole.VIEWER, // Revert to VIEWER when removing custom role
        assignedRoleId: null,
      },
    });
  }
}
