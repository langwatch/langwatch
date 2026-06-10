import { RoleBindingScopeType, type Group, type GroupMembership, type PrismaClient, type RoleBinding } from "@prisma/client";
import type {
  CreateBindingInput,
  CreateGroupInput,
  GroupRepository,
  GroupWithDetails,
  GroupWithMembers,
  PaginatedResult,
} from "./group.repository";

export class PrismaGroupRepository implements GroupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAllByOrganization({
    organizationId,
    page,
    limit,
  }: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<GroupWithDetails>> {
    const where = { organizationId };
    const [data, total] = await Promise.all([
      this.prisma.group.findMany({
        where,
        include: {
          roleBindings: {
            include: { customRole: { select: { id: true, name: true } } },
          },
          _count: { select: { members: true } },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.group.count({ where }),
    ]);
    return { data, pagination: { page, limit, total } };
  }

  async findById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GroupWithMembers | null> {
    return this.prisma.group.findFirst({
      where: { id, organizationId },
      include: {
        roleBindings: {
          include: { customRole: { select: { id: true, name: true } } },
        },
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  async findGroupOnly({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<Group | null> {
    return this.prisma.group.findFirst({
      where: { id, organizationId },
    });
  }

  async create(data: CreateGroupInput): Promise<Group> {
    return this.prisma.group.create({ data });
  }

  async createAtomic({
    group,
    bindings,
    memberIds,
  }: {
    group: CreateGroupInput;
    bindings: CreateBindingInput[];
    memberIds: string[];
  }): Promise<Group> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.group.create({ data: group });

      if (bindings.length > 0) {
        await tx.roleBinding.createMany({ data: bindings });
      }

      if (memberIds.length > 0) {
        await tx.groupMembership.createMany({
          data: memberIds.map((userId) => ({
            groupId: created.id,
            userId,
          })),
        });
      }

      return created;
    });
  }

  async rename({
    id,
    organizationId,
    name,
    slug,
  }: {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
  }): Promise<Group | null> {
    const result = await this.prisma.group.updateMany({
      where: { id, organizationId },
      data: { name, slug },
    });
    if (result.count === 0) return null;
    return this.prisma.group.findUnique({ where: { id } });
  }

  async delete({ id, organizationId }: { id: string; organizationId: string }): Promise<void> {
    await this.prisma.group.deleteMany({ where: { id, organizationId } });
  }

  async findMembers({ groupId }: { groupId: string }) {
    return this.prisma.groupMembership.findMany({
      where: { groupId },
      select: {
        userId: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async addMember({
    groupId,
    userId,
  }: {
    groupId: string;
    userId: string;
  }): Promise<GroupMembership> {
    return this.prisma.groupMembership.create({
      data: { groupId, userId },
    });
  }

  async removeMember({
    groupId,
    userId,
  }: {
    groupId: string;
    userId: string;
  }): Promise<void> {
    await this.prisma.groupMembership.delete({
      where: { userId_groupId: { userId, groupId } },
    });
  }

  async findBindings({ groupId }: { groupId: string }) {
    return this.prisma.roleBinding.findMany({
      where: { groupId },
      include: { customRole: { select: { id: true, name: true } } },
    });
  }

  async createBinding(data: CreateBindingInput): Promise<RoleBinding> {
    return this.prisma.roleBinding.create({ data });
  }

  async findBinding({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<RoleBinding | null> {
    return this.prisma.roleBinding.findFirst({
      where: { id, organizationId },
    });
  }

  async deleteBinding({ id }: { id: string }): Promise<void> {
    await this.prisma.roleBinding.delete({ where: { id } });
  }

  async deleteAllMemberships({ groupId }: { groupId: string }): Promise<void> {
    await this.prisma.groupMembership.deleteMany({ where: { groupId } });
  }

  async deleteAllBindings({ groupId }: { groupId: string }): Promise<void> {
    await this.prisma.roleBinding.deleteMany({ where: { groupId } });
  }

  async isUserInOrganization({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const member = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId },
      select: { userId: true },
    });
    return !!member;
  }

  async validateScopeInOrganization({
    organizationId,
    scopeType,
    scopeId,
  }: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }): Promise<boolean> {
    if (scopeType === RoleBindingScopeType.ORGANIZATION) {
      return scopeId === organizationId;
    }
    if (scopeType === RoleBindingScopeType.TEAM) {
      const team = await this.prisma.team.findFirst({
        where: { id: scopeId, organizationId },
        select: { id: true },
      });
      return !!team;
    }
    if (scopeType === RoleBindingScopeType.PROJECT) {
      const project = await this.prisma.project.findFirst({
        where: { id: scopeId, team: { organizationId } },
        select: { id: true },
      });
      return !!project;
    }
    return false;
  }

  async findUniqueSlug({
    organizationId,
    baseSlug,
    excludeId,
  }: {
    organizationId: string;
    baseSlug: string;
    excludeId?: string;
  }): Promise<string> {
    let candidate = baseSlug;
    let suffix = 2;
    while (true) {
      const exists = await this.prisma.group.findFirst({
        where: {
          organizationId,
          slug: candidate,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      });
      if (!exists) return candidate;
      candidate = `${baseSlug}-${suffix++}`;
    }
  }
}
