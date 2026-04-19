import {
  type CustomRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

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
    const team = await this.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { organizationId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.roleBinding.deleteMany({
        where: { organizationId: team.organizationId, userId, scopeType: RoleBindingScopeType.TEAM, scopeId: teamId },
      });
      await tx.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: team.organizationId,
          userId,
          role: TeamUserRole.CUSTOM,
          customRoleId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
        },
      });
    });
  }

  async removeFromUser(userId: string, teamId: string) {
    const team = await this.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { organizationId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.roleBinding.deleteMany({
        where: { organizationId: team.organizationId, userId, scopeType: RoleBindingScopeType.TEAM, scopeId: teamId },
      });
      await tx.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: team.organizationId,
          userId,
          role: TeamUserRole.VIEWER,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
        },
      });
    });
  }
}
