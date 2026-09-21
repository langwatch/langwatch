// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  OrganizationUserRole,
  Prisma,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  ScimRepository,
  type ScimGrantBindingScope,
  type ScimGroupMembershipRecord,
  type ScimGroupRecord,
  type ScimMembershipRecord,
  type ScimRoleBindingRecord,
  type ScimTokenRecord,
  type ScimTokenIdentity,
} from "../scim.repository.ts";

/** The Prisma group row as the SCIM seam reads it: one clock above this line. */
function scimGroupRecordOf(row: {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  scimSource: string | null;
  externalId: string | null;
  scimConnectionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ScimGroupRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    scimSource: row.scimSource,
    externalId: row.externalId,
    connectionId: row.scimConnectionId,
    createdAt: fromDate(row.createdAt),
    updatedAt: fromDate(row.updatedAt),
  };
}

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
    }): Promise<{ connectionId: string }[]>;
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
export class PrismaScimRepository extends ScimRepository {
  private constructor(private readonly prisma: ScimDatabase) {
    super();
  }
  static create(database: PrismaClient): PrismaScimRepository {
    if (!isScimDatabase(database)) {
      throw new Error("SCIM requires a Prisma database with SCIM models");
    }
    return new PrismaScimRepository(database);
  }

  findOrganizationBySsoDomain(input: { domain: string }): Promise<{ id: string } | null> {
    return this.prisma.organization.findUnique({
      where: { ssoDomain: input.domain },
      select: { id: true },
    });
  }

  // Arrow instance properties, not prototype methods, from here through
  // `removeMembership`: the base class declares these members as properties
  // of function type (so tests can reference a mock repository's methods
  // unbound without tripping `typescript/unbound-method`), and TypeScript
  // requires a subclass to match that declaration shape exactly (TS2425).
  findMembership = (input: {
    organizationId: string;
    userId: string;
  }): Promise<ScimMembershipRecord | null> => {
    return this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: input },
      include: { user: true },
    });
  };
  listMemberships = async (input: {
    organizationId: string;
    email?: string;
    userIds?: readonly string[];
    startIndex: number;
    count: number;
  }): Promise<{ rows: ScimMembershipRecord[]; total: number }> => {
    const where = {
      organizationId: input.organizationId,
      ...(input.email
        ? { user: { email: { equals: input.email, mode: Prisma.QueryMode.insensitive } } }
        : {}),
      ...(input.userIds ? { userId: { in: [...input.userIds] } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where,
        include: { user: true },
        skip: input.startIndex - 1,
        take: input.count,
        // A page is skip/take over a result set and Postgres promises no order
        // without being asked: an unordered scan hands the same person to two
        // pages and never hands over somebody else at all.
        orderBy: { userId: "asc" },
      }),
      this.prisma.organizationUser.count({ where }),
    ]);
    return { rows, total };
  };
  addMembership = async (input: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<void> => {
    await this.prisma.organizationUser.create({
      data: { ...input, role: organizationUserRole(input.role) },
    });
  };
  removeMembership = async (input: { organizationId: string; userId: string }): Promise<void> => {
    await this.prisma.organizationUser.delete({
      where: { userId_organizationId: input },
    });
  };
  async findGroup(input: { organizationId: string; id: string }): Promise<ScimGroupRecord | null> {
    const row = await this.prisma.group.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });

    return row ? scimGroupRecordOf(row) : null;
  }
  async listGroups(input: {
    organizationId: string;
    connectionId?: string | null;
    displayName?: string;
    externalId?: string;
    startIndex: number;
    count: number;
  }): Promise<{
    rows: (ScimGroupRecord & { members: ScimGroupMembershipRecord[] })[];
    total: number;
  }> {
    const where = {
      organizationId: input.organizationId,
      scimSource: { not: null },
      // Legacy tokens keep organization-wide reach; a scoped token also sees
      // the groups that predate connection scoping.
      ...(input.connectionId
        ? { OR: [{ scimConnectionId: input.connectionId }, { scimConnectionId: null }] }
        : {}),
      ...(input.displayName
        ? { name: { equals: input.displayName, mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
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
        // `createdAt` alone leaves groups made in the same instant in an order
        // the store picks, and two pages cut from two such orders overlap.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.group.count({ where }),
    ]);
    return {
      rows: rows.map((row) => ({ ...scimGroupRecordOf(row), members: row.members })),
      total,
    };
  }
  async findGroupByExternalId(input: {
    organizationId: string;
    connectionId: string | null;
    externalId: string;
  }): Promise<ScimGroupRecord | null> {
    const row = await this.prisma.group.findFirst({
      where: {
        organizationId: input.organizationId,
        scimConnectionId: input.connectionId,
        externalId: input.externalId,
      },
    });

    return row ? scimGroupRecordOf(row) : null;
  }
  async createGroup(input: {
    organizationId: string;
    name: string;
    slug: string;
    externalId: string | null;
    connectionId: string | null;
  }): Promise<ScimGroupRecord> {
    const { connectionId, ...group } = input;

    return scimGroupRecordOf(
      await this.prisma.group.create({
        data: { ...group, scimSource: "scim", scimConnectionId: connectionId },
      }),
    );
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
    const rows: { userId: string }[] = await this.prisma.groupMembership.findMany({
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
  // Arrow instance property to match the base class's property-typed
  // declaration (see `findMembership` above for why).
  createToken = (input: {
    organizationId: string;
    connectionId: string;
    hashedToken: string;
    description: string | null;
  }): Promise<{ id: string }> => {
    return this.prisma.scimToken.create({ data: input, select: { id: true } });
  };
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
  // Arrow instance property to match the base class's property-typed
  // declaration (see `findMembership` above for why).
  revokeToken = async (input: { organizationId: string; tokenId: string }): Promise<boolean> => {
    return (
      (
        await this.prisma.scimToken.deleteMany({
          where: { id: input.tokenId, organizationId: input.organizationId },
        })
      ).count > 0
    );
  };
  findToken(input: { organizationId: string; tokenId: string }): Promise<ScimTokenIdentity | null> {
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
  findTokenByHash(hashedToken: string): Promise<ScimTokenIdentity | null> {
    return this.prisma.scimToken.findFirst({
      where: { hashedToken },
      select: { id: true, organizationId: true, connectionId: true },
    });
  }
  // Arrow instance property to match the base class's property-typed
  // declaration (see `findMembership` above for why).
  recordTokenUse = async (input: { tokenId: string; usedAt: Instant }): Promise<void> => {
    await this.prisma.scimToken.updateMany({
      where: { id: input.tokenId },
      data: { lastUsedAt: toDate(input.usedAt) },
    });
  };

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

  async findDirectoryUserId(input: {
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
