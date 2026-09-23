import {
  scimRefusalReasonSchema,
  type DirectoryIdentityRow,
  type ScimDirectoryOwnership,
  type ScimRequestLogEntry,
  type ScimRequestRecord,
} from "@langwatch/enterprise-scim-contract";
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
  type ScimOrganizationUserRecord,
  type ScimRoleBindingRecord,
  type ScimTokenRecord,
  type ScimTokenIdentity,
  type ScimUserRecord,
  type ScimUserResourceRecord,
} from "../scim.repository.ts";

/** The Prisma directory-resource row as the SCIM seam reads it. */
function scimUserResourceOf(row: {
  organizationId: string;
  userId: string;
  userName: string;
  name: string | null;
  active: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ScimUserResourceRecord {
  return {
    organizationId: row.organizationId,
    userId: row.userId,
    userName: row.userName,
    name: row.name,
    active: row.active,
    deletedAt: row.deletedAt === null ? null : fromDate(row.deletedAt),
    createdAt: fromDate(row.createdAt),
    updatedAt: fromDate(row.updatedAt),
  };
}

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
    findMany(input: {
      where: { connectionId: { in: string[] } };
      select: { connectionId: true; userId: true };
    }): Promise<{ connectionId: string; userId: string }[]>;
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
  /**
   * The page runs over two disjoint halves — the live directory resources,
   * then the members no directory has claimed — because a person can be
   * either without being the other, and a deleted resource is neither.
   *
   * Both halves are ordered by user id and the first half is exhausted before
   * the second begins, so a page is a slice of one settled sequence: Postgres
   * promises no order without being asked, and an unordered scan hands the
   * same person to two pages and never hands over somebody else at all.
   */
  findOrganizationUsers = async (input: {
    organizationId: string;
    userName?: string;
    userIds?: readonly string[];
    startIndex: number;
    count: number;
  }): Promise<{ rows: ScimOrganizationUserRecord[]; total: number }> => {
    const narrowing = input.userIds ? { userId: { in: [...input.userIds] } } : {};
    const named = input.userName;
    const claimedWhere = {
      organizationId: input.organizationId,
      deletedAt: null,
      ...narrowing,
      ...(named ? { userName: { equals: named, mode: Prisma.QueryMode.insensitive } } : {}),
    };
    const unclaimedWhere = {
      organizationId: input.organizationId,
      ...narrowing,
      user: {
        scimUserResources: { none: { organizationId: input.organizationId } },
        ...(named ? { email: { equals: named, mode: Prisma.QueryMode.insensitive } } : {}),
      },
    };
    const [claimed, unclaimed] = await Promise.all([
      this.prisma.scimUserResource.count({ where: claimedWhere }),
      this.prisma.organizationUser.count({ where: unclaimedWhere }),
    ]);
    const skip = input.startIndex - 1;
    const fromClaimed = Math.max(0, Math.min(input.count, claimed - skip));
    const fromUnclaimed = input.count - fromClaimed;
    const rows: ScimOrganizationUserRecord[] = [];
    if (fromClaimed > 0) {
      const resources = await this.prisma.scimUserResource.findMany({
        where: claimedWhere,
        include: { user: true },
        orderBy: { userId: "asc" },
        skip,
        take: fromClaimed,
      });
      rows.push(...resources.map((row) => ({ user: row.user, resource: scimUserResourceOf(row) })));
    }
    if (fromUnclaimed > 0) {
      const members = await this.prisma.organizationUser.findMany({
        where: unclaimedWhere,
        include: { user: true },
        orderBy: { userId: "asc" },
        skip: Math.max(0, skip - claimed),
        take: fromUnclaimed,
      });
      rows.push(...members.map((row) => ({ user: row.user, resource: null })));
    }
    return { rows, total: claimed + unclaimed };
  };
  recordRequest = async (request: ScimRequestRecord): Promise<void> => {
    await this.prisma.scimRequestLog.create({ data: request });
  };
  async findRequestLog(input: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<ScimRequestLogEntry[]> {
    const rows = await this.prisma.scimRequestLog.findMany({
      // The organization is in the predicate as well as the connection: a
      // connection id is not a tenant, and this table is read by a surface
      // that has one.
      where: { organizationId: input.organizationId, connectionId: input.connectionId },
      orderBy: { occurredAt: "desc" },
      take: input.limit,
    });

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      connectionId: row.connectionId,
      method: row.method,
      resource: row.resource,
      status: row.status,
      reason: scimRefusalReasonSchema.safeParse(row.reason).data ?? null,
      detail: row.detail,
      occurredAt: row.occurredAt,
    }));
  }
  async findExpiredRequestIds(input: { before: Instant; limit: number }): Promise<string[]> {
    const rows = await this.prisma.scimRequestLog.findMany({
      where: { occurredAt: { lt: toDate(input.before) } },
      select: { id: true },
      take: input.limit,
    });

    return rows.map((row) => row.id);
  }
  async deleteRequests(input: { ids: readonly string[] }): Promise<number> {
    const { count } = await this.prisma.scimRequestLog.deleteMany({
      where: { id: { in: [...input.ids] } },
    });

    return count;
  }
  findUserResource = async (input: {
    organizationId: string;
    userId: string;
  }): Promise<ScimUserResourceRecord | null> => {
    const row = await this.prisma.scimUserResource.findUnique({
      where: { organizationId_userId: input },
    });
    return row ? scimUserResourceOf(row) : null;
  };
  findUserByResourceName = async (input: {
    organizationId: string;
    userName: string;
  }): Promise<ScimUserRecord | null> => {
    const row = await this.prisma.scimUserResource.findFirst({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        userName: { equals: input.userName.trim(), mode: Prisma.QueryMode.insensitive },
      },
      include: { user: true },
    });
    return row?.user ?? null;
  };
  hasLegacyNameConflict = async (input: {
    organizationId: string;
    userId?: string;
    userName: string;
  }): Promise<boolean> => {
    const holder = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId: input.organizationId,
        ...(input.userId === void 0 ? {} : { userId: { not: input.userId } }),
        user: {
          scimUserResources: { none: { organizationId: input.organizationId } },
          email: { equals: input.userName.trim(), mode: Prisma.QueryMode.insensitive },
        },
      },
      select: { userId: true },
    });
    return holder !== null;
  };
  saveUserResource = async (input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
    active: boolean;
  }): Promise<ScimUserResourceRecord> => {
    const userName = input.userName.trim().toLowerCase();
    const row = await this.prisma.scimUserResource.upsert({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: input.userId,
        },
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        userName,
        name: input.name,
        active: input.active,
        deletedAt: null,
      },
      update: { userName, name: input.name, active: input.active, deletedAt: null },
    });
    return scimUserResourceOf(row);
  };
  markUserResourceDeleted = async (input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
  }): Promise<void> => {
    const deletedAt = new Date();
    await this.prisma.scimUserResource.upsert({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: input.userId,
        },
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        userName: input.userName.trim().toLowerCase(),
        name: input.name,
        active: false,
        deletedAt,
      },
      update: { active: false, deletedAt },
    });
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

  async findDirectoryIdentities(input: {
    connectionId: string;
    limit: number;
  }): Promise<DirectoryIdentityRow[]> {
    const rows = await this.prisma.scimExternalId.findMany({
      where: { connectionId: input.connectionId },
      orderBy: { updatedAt: "desc" },
      take: input.limit,
      select: {
        connectionId: true,
        externalId: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      connectionId: row.connectionId,
      externalId: row.externalId,
      userId: row.userId,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }));
  }

  async findDirectoryOwnership(input: {
    connectionIds: string[];
  }): Promise<ScimDirectoryOwnership[]> {
    if (input.connectionIds.length === 0) return [];

    return this.prisma.scimExternalId.findMany({
      where: { connectionId: { in: input.connectionIds } },
      select: { connectionId: true, userId: true },
    });
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
