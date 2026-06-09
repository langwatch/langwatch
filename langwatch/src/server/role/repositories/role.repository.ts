import {
  type CustomRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

export const CUSTOM_ROLE_KIND = {
  CUSTOM: "custom",
  SYSTEM_API_KEY: "system_api_key",
} as const;

export type RolePrismaDelegate = PrismaClient | Prisma.TransactionClient;

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
  constructor(private readonly prisma: RolePrismaDelegate) {}

  async findAllByOrganization(organizationId: string) {
    return this.prisma.customRole.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findUserCreatedByOrganization(organizationId: string) {
    return this.prisma.customRole.findMany({
      where: {
        organizationId,
        kind: CUSTOM_ROLE_KIND.CUSTOM,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(roleId: string) {
    return this.prisma.customRole.findUnique({
      where: { id: roleId },
    });
  }

  async findByIdInOrg(roleId: string, organizationId: string) {
    return this.prisma.customRole.findUnique({
      where: { id: roleId, organizationId },
      select: { id: true, permissions: true },
    });
  }

  async findAssignableByIds(roleIds: string[], organizationId: string) {
    return this.prisma.customRole.findMany({
      where: {
        id: { in: roleIds },
        organizationId,
        kind: CUSTOM_ROLE_KIND.CUSTOM,
      },
      select: { id: true },
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
        kind: params.kind,
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

  async deleteByIds(roleIds: string[]) {
    if (roleIds.length === 0) return;
    await this.prisma.customRole.deleteMany({
      where: { id: { in: roleIds } },
    });
  }

  async isExclusiveToApiKey({
    roleId,
    apiKeyId,
  }: {
    roleId: string;
    apiKeyId: string;
  }): Promise<boolean> {
    const role = await this.prisma.customRole.findFirst({
      where: {
        id: roleId,
        roleBindings: { every: { apiKeyId } },
        assignedUsers: { none: {} },
      },
      select: { id: true },
    });
    return role !== null;
  }

  async deleteExclusiveToApiKey({
    roleIds,
    apiKeyId,
  }: {
    roleIds: string[];
    apiKeyId: string;
  }) {
    if (roleIds.length === 0) return;
    // Drop this api key's CUSTOM bindings that point at these roles FIRST.
    // The customRoleId FK is ON DELETE SET NULL, but the
    // RoleBinding_custom_role_check constraint forbids a CUSTOM binding with a
    // null customRoleId, so deleting the role while its binding still exists
    // throws. Once the binding is gone the role can be deleted cleanly (and an
    // exclusive role is left with zero bindings, which `every` matches
    // vacuously). Bindings of a revoked key are void anyway — the key row
    // survives (revokedAt) as the audit record. Shared roles (bindings from
    // other keys remain) fail the `every` guard and are correctly kept.
    await this.prisma.roleBinding.deleteMany({
      where: { apiKeyId, customRoleId: { in: roleIds } },
    });
    await this.prisma.customRole.deleteMany({
      where: {
        id: { in: roleIds },
        roleBindings: { every: { apiKeyId } },
        assignedUsers: { none: {} },
      },
    });
  }

  async findTeamById(teamId: string) {
    return this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
  }

  async findUserTeamBinding({
    userId,
    organizationId,
    teamId,
  }: {
    userId: string;
    organizationId: string;
    teamId: string;
  }) {
    return this.prisma.roleBinding.findFirst({
      where: {
        userId,
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
    });
  }

  async findTeamMembersWithUsers({
    organizationId,
    teamId,
  }: {
    organizationId: string;
    teamId: string;
  }) {
    return this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
        userId: { not: null },
      },
      include: { user: true },
    });
  }

  async findUserCustomRoleBinding({
    userId,
    organizationId,
    teamId,
  }: {
    userId: string;
    organizationId: string;
    teamId: string;
  }) {
    return this.prisma.roleBinding.findFirst({
      where: {
        userId,
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
        customRoleId: { not: null },
      },
      select: { customRoleId: true },
    });
  }

  private requireFullClient(): PrismaClient {
    if (!("$transaction" in this.prisma)) {
      throw new Error("assignToUser/removeFromUser require PrismaClient, not a TransactionClient");
    }
    return this.prisma as PrismaClient;
  }

  async assignToUser(userId: string, teamId: string, customRoleId: string) {
    const prisma = this.requireFullClient();
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { organizationId: true },
    });

    await prisma.$transaction(async (tx) => {
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
    const prisma = this.requireFullClient();
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { organizationId: true },
    });

    await prisma.$transaction(async (tx) => {
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
