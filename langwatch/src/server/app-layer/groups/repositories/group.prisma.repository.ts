import type { Group, GroupMembership, PrismaClient, RoleBinding } from "@prisma/client";
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

  async rename({
    id,
    name,
    slug,
  }: {
    id: string;
    name: string;
    slug: string;
  }): Promise<Group> {
    return this.prisma.group.update({
      where: { id },
      data: { name, slug },
    });
  }

  async delete({ id }: { id: string }): Promise<void> {
    await this.prisma.group.delete({ where: { id } });
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
