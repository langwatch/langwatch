// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  OrganizationUserRole,
  Prisma,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  ScimRepositoryPort,
  type ScimGrantBindingScope,
  type ScimGroupMembershipRecord,
  type ScimGroupRecord,
  type ScimMembershipRecord,
  type ScimRoleBindingRecord,
  type ScimTokenRecord,
  type ScimTokenIdentity,
} from "../../ports/scim-repository.port";

type ScimIdentityDatabase = {
  ssoConnection: {
    findFirst(input: {
      where: { id: string; organizationId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  scimExternalId: {
    findUnique(input: {
      where: {
        connectionId_externalId: { connectionId: string; externalId: string };
      };
      select: { userId: true };
    }): Promise<{ userId: string } | null>;
    findMany(input: {
      where: { userId: string };
      select: { connectionId: true };
    }): Promise<Array<{ connectionId: string }>>;
    upsert(input: {
      where: {
        connectionId_externalId: { connectionId: string; externalId: string };
      };
      create: { connectionId: string; externalId: string; userId: string };
      update: { userId: string };
    }): Promise<unknown>;
    deleteMany(input: {
      where:
        | { connectionId: string; externalId: string }
        | { connectionId: string; userId: string };
    }): Promise<unknown>;
  };
};

type ScimDatabase = PrismaClient & ScimIdentityDatabase;

function isScimDatabase(value: object): value is ScimDatabase {
  return (
    "organization" in value &&
    "organizationUser" in value &&
    "group" in value &&
    "groupMembership" in value &&
    "roleBinding" in value &&
    "scimToken" in value &&
    "ssoConnection" in value &&
    "scimExternalId" in value
  );
}

/** Strict generated-Prisma implementation of the SCIM persistence port. */
export class PrismaScimRepository extends ScimRepositoryPort {
  private constructor(private readonly prisma: ScimDatabase) {
    super();
  }
  static create(database: object): PrismaScimRepository {
    if (!isScimDatabase(database)) {
      throw new Error("SCIM requires a Prisma database with SCIM models");
    }
    return new PrismaScimRepository(database);
  }

  tryFindOrganizationBySsoDomain(input: { domain: string }): Promise<{ id: string } | null> {
    return this.prisma.organization.findUnique({
      where: { ssoDomain: input.domain },
      select: { id: true },
    });
  }

  tryFindMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<ScimMembershipRecord | null> {
    return this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: input },
      include: { user: true },
    });
  }
  async listMemberships(input: {
    organizationId: string;
    email?: string;
    startIndex: number;
    count: number;
  }): Promise<{ rows: ScimMembershipRecord[]; total: number }> {
    const where = {
      organizationId: input.organizationId,
      ...(input.email
        ? { user: { email: { equals: input.email, mode: Prisma.QueryMode.insensitive } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where,
        include: { user: true },
        skip: input.startIndex - 1,
        take: input.count,
      }),
      this.prisma.organizationUser.count({ where }),
    ]);
    return { rows, total };
  }
  async addMembership(input: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<void> {
    await this.prisma.organizationUser.create({
      data: { ...input, role: organizationUserRole(input.role) },
    });
  }
  async removeMembership(input: { organizationId: string; userId: string }): Promise<void> {
    await this.prisma.organizationUser.delete({
      where: { userId_organizationId: input },
    });
  }
  tryFindGroup(input: { organizationId: string; id: string }): Promise<ScimGroupRecord | null> {
    return this.prisma.group.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
  }
  async listGroups(input: {
    organizationId: string;
    displayName?: string;
    startIndex: number;
    count: number;
  }): Promise<{
    rows: Array<ScimGroupRecord & { members: ScimGroupMembershipRecord[] }>;
    total: number;
  }> {
    const where = {
      organizationId: input.organizationId,
      scimSource: { not: null },
      ...(input.displayName
        ? { name: { equals: input.displayName, mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.group.findMany({
        where,
        include: {
          members: {
            include: { user: { select: { id: true, email: true, name: true } } },
          },
        },
        skip: input.startIndex - 1,
        take: input.count,
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.group.count({ where }),
    ]);
    return { rows, total };
  }
  createGroup(input: {
    organizationId: string;
    name: string;
    slug: string;
    externalId: string | null;
  }): Promise<ScimGroupRecord> {
    return this.prisma.group.create({ data: { ...input, scimSource: "scim" } });
  }
  async renameGroup(input: { id: string; name: string }): Promise<void> {
    await this.prisma.group.update({
      where: { id: input.id },
      data: { name: input.name },
    });
  }
  async deleteGroup(input: { id: string }): Promise<void> {
    await this.prisma.group.delete({ where: { id: input.id } });
  }
  listGroupMembers(input: { groupId: string }): Promise<ScimGroupMembershipRecord[]> {
    return this.prisma.groupMembership.findMany({
      where: { groupId: input.groupId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
  }
  async listGroupMemberIds(input: { groupId: string }): Promise<string[]> {
    const rows: Array<{ userId: string }> = await this.prisma.groupMembership.findMany({
      where: { groupId: input.groupId },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }
  async addGroupMember(input: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const member = await this.prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: input.userId,
          organizationId: input.organizationId,
        },
      },
      select: { userId: true },
    });
    if (!member) return;
    await this.prisma.groupMembership.upsert({
      where: { userId_groupId: { userId: input.userId, groupId: input.groupId } },
      update: {},
      create: { userId: input.userId, groupId: input.groupId },
    });
  }
  async removeGroupMembers(input: { groupId: string; userIds: string[] }): Promise<void> {
    await this.prisma.groupMembership.deleteMany({
      where: { groupId: input.groupId, userId: { in: input.userIds } },
    });
  }
  async groupSlugExists(input: { organizationId: string; slug: string }): Promise<boolean> {
    return (await this.prisma.group.findFirst({ where: input, select: { id: true } })) !== null;
  }
  listRoleBindings(scope: ScimGrantBindingScope): Promise<ScimRoleBindingRecord[]> {
    return this.prisma.roleBinding.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(scope.kind === "organization-membership"
          ? {
              userId: scope.userId,
              scopeType: "ORGANIZATION",
              scopeId: scope.organizationId,
            }
          : scope.kind === "member-offboarding"
            ? { userId: scope.userId }
            : { groupId: scope.groupId }),
      },
      select: {
        id: true,
        userId: true,
        groupId: true,
        apiKeyId: true,
        scopeType: true,
        scopeId: true,
        role: true,
        customRoleId: true,
      },
    });
  }
  createToken(input: {
    organizationId: string;
    connectionId: string;
    hashedToken: string;
    description: string | null;
  }): Promise<{ id: string }> {
    return this.prisma.scimToken.create({ data: input, select: { id: true } });
  }
  listTokens(organizationId: string): Promise<ScimTokenRecord[]> {
    return this.prisma.scimToken.findMany({
      where: { organizationId },
      select: {
        id: true,
        organizationId: true,
        connectionId: true,
        description: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
  async revokeToken(input: { organizationId: string; tokenId: string }): Promise<boolean> {
    return (
      (
        await this.prisma.scimToken.deleteMany({
          where: { id: input.tokenId, organizationId: input.organizationId },
        })
      ).count > 0
    );
  }
  tryFindToken(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<ScimTokenIdentity | null> {
    return this.prisma.scimToken.findFirst({
      where: { id: input.tokenId, organizationId: input.organizationId },
      select: { id: true, organizationId: true, connectionId: true },
    });
  }
  async revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<number> {
    const result = await this.prisma.scimToken.deleteMany({ where: input });
    return result.count;
  }
  tryFindTokenByHash(hashedToken: string): Promise<ScimTokenIdentity | null> {
    return this.prisma.scimToken.findFirst({
      where: { hashedToken },
      select: { id: true, organizationId: true, connectionId: true },
    });
  }
  async recordTokenUse(input: { tokenId: string; usedAt: Date }): Promise<void> {
    await this.prisma.scimToken.updateMany({
      where: { id: input.tokenId },
      data: { lastUsedAt: input.usedAt },
    });
  }

  async scimConnectionExists(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<boolean> {
    const connection = await this.prisma.ssoConnection.findFirst({
      where: {
        id: input.connectionId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    return connection !== null;
  }

  async tryFindDirectoryUserId(input: {
    connectionId: string;
    externalId: string;
  }): Promise<string | null> {
    const row = await this.prisma.scimExternalId.findUnique({
      where: { connectionId_externalId: input },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }

  async rememberDirectoryIdentity(input: {
    connectionId: string;
    externalId: string;
    userId: string;
  }): Promise<void> {
    await this.prisma.scimExternalId.upsert({
      where: {
        connectionId_externalId: {
          connectionId: input.connectionId,
          externalId: input.externalId,
        },
      },
      create: input,
      update: { userId: input.userId },
    });
  }

  async forgetDirectoryIdentity(input: {
    connectionId: string;
    externalId: string;
  }): Promise<void> {
    await this.prisma.scimExternalId.deleteMany({ where: input });
  }

  async forgetDirectoryIdentitiesForUser(input: {
    connectionId: string;
    userId: string;
  }): Promise<void> {
    await this.prisma.scimExternalId.deleteMany({ where: input });
  }

  async listDirectoryConnectionsForUser(input: { userId: string }): Promise<string[]> {
    const rows = await this.prisma.scimExternalId.findMany({
      where: input,
      select: { connectionId: true },
    });
    return rows.map((row) => row.connectionId);
  }
}

function organizationUserRole(role: string): OrganizationUserRole {
  switch (role) {
    case "MEMBER":
      return OrganizationUserRole.MEMBER;
    case "ADMIN":
      return OrganizationUserRole.ADMIN;
    case "EXTERNAL":
      return OrganizationUserRole.EXTERNAL;
    default:
      throw new Error(`Unsupported SCIM organization role: ${role}`);
  }
}
