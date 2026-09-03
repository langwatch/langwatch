import {
  GroupMemberAlreadyAddedError,
  GroupMembershipNotFoundError,
  GroupNotFoundError,
  ScimManagedGroupError,
  type OrganizationGroup,
  type OrganizationGroupMember,
} from "@langwatch/organization-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import {
  GroupRepository,
  type OrganizationGroupWithMemberCount,
} from "../group.repository";

const groupSelect = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  externalId: true,
  scimSource: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaGroupRepository extends GroupRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: PrismaClient): PrismaGroupRepository {
    return new PrismaGroupRepository(database);
  }

  async get(input: {
    groupId: string;
    organizationId: string;
  }): Promise<OrganizationGroup> {
    const group = await this.database.group.findFirst({
      where: { id: input.groupId, organizationId: input.organizationId },
      select: groupSelect,
    });
    if (!group) throw new GroupNotFoundError(input.groupId);
    return group;
  }

  async list(input: { organizationId: string; page: number; limit: number }): Promise<{
    data: OrganizationGroupWithMemberCount[];
    pagination: { page: number; limit: number; total: number };
  }> {
    const where = { organizationId: input.organizationId };
    const [rows, total] = await Promise.all([
      this.database.group.findMany({
        where,
        select: {
          ...groupSelect,
          _count: {
            select: {
              members: {
                where: {
                  user: {
                    orgMemberships: {
                      some: { organizationId: input.organizationId },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.database.group.count({ where }),
    ]);
    return {
      data: rows.map(({ _count, ...group }) => ({
        ...group,
        memberCount: _count.members,
      })),
      pagination: { page: input.page, limit: input.limit, total },
    };
  }

  async listForMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationGroupWithMemberCount[]> {
    const rows = await this.database.group.findMany({
      where: {
        organizationId: input.organizationId,
        members: { some: { userId: input.userId } },
      },
      select: {
        ...groupSelect,
        _count: { select: { members: true } },
      },
      orderBy: { name: "asc" },
    });
    return rows.map(({ _count, ...group }) => ({
      ...group,
      memberCount: _count.members,
    }));
  }

  async listMembers(input: {
    groupId: string;
    organizationId: string;
  }): Promise<OrganizationGroupMember[]> {
    const rows = await this.database.groupMembership.findMany({
      where: {
        groupId: input.groupId,
        group: { organizationId: input.organizationId },
        user: {
          orgMemberships: { some: { organizationId: input.organizationId } },
        },
      },
      select: {
        userId: true,
        user: {
          select: { name: true, email: true, image: true },
        },
      },
    });
    return rows.map(({ userId, user }) => ({ userId, ...user }));
  }

  async listMembersForGroups(input: {
    groupIds: string[];
    organizationId: string;
  }): Promise<Map<string, OrganizationGroupMember[]>> {
    if (input.groupIds.length === 0) return new Map();
    const rows = await this.database.groupMembership.findMany({
      where: {
        groupId: { in: input.groupIds },
        group: { organizationId: input.organizationId },
        user: {
          orgMemberships: { some: { organizationId: input.organizationId } },
        },
      },
      select: {
        groupId: true,
        userId: true,
        user: { select: { name: true, email: true, image: true } },
      },
    });
    const members = new Map<string, OrganizationGroupMember[]>();
    for (const row of rows) {
      const groupMembers = members.get(row.groupId) ?? [];
      groupMembers.push({ userId: row.userId, ...row.user });
      members.set(row.groupId, groupMembers);
    }
    return members;
  }

  async nextAvailableSlug(input: {
    organizationId: string;
    baseSlug: string;
    excludeGroupId?: string;
  }): Promise<string> {
    let candidate = input.baseSlug;
    let suffix = 2;
    for (;;) {
      const row = await this.database.group.findFirst({
        where: {
          organizationId: input.organizationId,
          slug: candidate,
          ...(input.excludeGroupId ? { id: { not: input.excludeGroupId } } : {}),
        },
        select: { id: true },
      });
      if (!row) return candidate;
      candidate = `${input.baseSlug}-${suffix++}`;
    }
  }

  create(input: {
    groupId: string;
    organizationId: string;
    name: string;
    slug: string;
    memberIds: string[];
  }): Promise<OrganizationGroup> {
    return this.database.$transaction(async (transaction) => {
      const group = await transaction.group.create({
        data: {
          id: input.groupId,
          organizationId: input.organizationId,
          name: input.name,
          slug: input.slug,
        },
        select: groupSelect,
      });
      if (input.memberIds.length > 0) {
        await transaction.groupMembership.createMany({
          data: input.memberIds.map((userId) => ({
            groupId: group.id,
            userId,
          })),
        });
      }
      return group;
    });
  }

  async rename(input: {
    groupId: string;
    organizationId: string;
    name: string;
    slug: string;
  }): Promise<OrganizationGroup> {
    const updated = await this.database.group.updateMany({
      where: { id: input.groupId, organizationId: input.organizationId },
      data: { name: input.name, slug: input.slug },
    });
    if (updated.count === 0) throw new GroupNotFoundError(input.groupId);
    return this.get(input);
  }

  async delete(input: { groupId: string; organizationId: string }): Promise<void> {
    const deleted = await this.database.group.deleteMany({
      where: { id: input.groupId, organizationId: input.organizationId },
    });
    if (deleted.count === 0) throw new GroupNotFoundError(input.groupId);
  }

  async addMember(input: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    await this.get(input);
    try {
      await this.database.groupMembership.create({
        data: { groupId: input.groupId, userId: input.userId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new GroupMemberAlreadyAddedError(input.userId);
      }
      throw error;
    }
  }

  async removeMember(input: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    await this.get(input);
    const deleted = await this.database.groupMembership.deleteMany({
      where: { groupId: input.groupId, userId: input.userId },
    });
    if (deleted.count === 0) {
      throw new GroupMembershipNotFoundError(input.userId);
    }
  }

  async applyEdits(input: {
    groupId: string;
    organizationId: string;
    rename?: { name: string; slug: string } | null;
    memberUserIdsToAdd: string[];
    memberUserIdsToRemove: string[];
  }): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const group = await transaction.group.findFirst({
        where: { id: input.groupId, organizationId: input.organizationId },
        select: { id: true, scimSource: true },
      });
      if (!group) throw new GroupNotFoundError(input.groupId);
      if (
        group.scimSource &&
        (input.rename ||
          input.memberUserIdsToAdd.length > 0 ||
          input.memberUserIdsToRemove.length > 0)
      ) {
        throw new ScimManagedGroupError(input.groupId);
      }
      if (input.rename) {
        await transaction.group.update({
          where: { id: input.groupId },
          data: input.rename,
        });
      }
      if (input.memberUserIdsToRemove.length > 0) {
        await transaction.groupMembership.deleteMany({
          where: {
            groupId: input.groupId,
            userId: { in: input.memberUserIdsToRemove },
          },
        });
      }
      if (input.memberUserIdsToAdd.length > 0) {
        await transaction.groupMembership.createMany({
          data: input.memberUserIdsToAdd.map((userId) => ({
            groupId: input.groupId,
            userId,
          })),
          skipDuplicates: true,
        });
      }
    });
  }
}
