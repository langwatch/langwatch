import {
  type Group,
  type GroupMembership,
  type PrismaClient,
  type RoleBinding,
  RoleBindingScopeType,
} from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
  type LedgerActor,
} from "~/server/app-layer/authz/ledger";
import { scopesTouchPersonalTeam } from "~/server/role-bindings/personal-team-scope";
import type {
  CreateBindingInput,
  CreatedBinding,
  CreateGroupInput,
  GroupRepository,
  GroupWithDetails,
  GroupWithMembers,
  PaginatedResult,
} from "./group.repository";

/** The grant a group carries, as the ledger's attach shape reads it. */
function attachFor(binding: CreateBindingInput) {
  return {
    bindingId: binding.id,
    principal: { groupId: binding.groupId },
    role: binding.role,
    customRoleId: binding.customRoleId,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
  };
}

export class PrismaGroupRepository implements GroupRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly writer: GrantsLedgerWriter = grantsLedgerWriter(),
  ) {}

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
          _count: {
            select: {
              members: {
                where: {
                  user: {
                    orgMemberships: { some: { organizationId } },
                  },
                },
              },
            },
          },
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
          where: {
            user: {
              orgMemberships: { some: { organizationId } },
            },
          },
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
    actor,
  }: {
    group: CreateGroupInput;
    bindings: CreateBindingInput[];
    memberIds: string[];
    actor: LedgerActor;
  }): Promise<Group> {
    // The group row and its memberships are not grant facts, so they keep the
    // transaction; the grants the group carries are one command after it
    // commits, because the ledger is their only writer.
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.group.create({ data: group });

      if (memberIds.length > 0) {
        await tx.groupMembership.createMany({
          data: memberIds.map((userId) => ({
            groupId: row.id,
            userId,
          })),
        });
      }

      return row;
    });

    if (bindings.length > 0) {
      await this.writer.attachBindings({
        organizationId: group.organizationId,
        bindings: bindings.map(attachFor),
        actor,
        onDuplicate: "skip",
      });
    }

    return created;
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

  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
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

  async createBinding(
    data: CreateBindingInput,
    { actor }: { actor: LedgerActor },
  ): Promise<CreatedBinding> {
    await this.writer.attachBindings({
      organizationId: data.organizationId,
      bindings: [attachFor(data)],
      actor,
      onDuplicate: "skip",
    });
    return {
      id: data.id,
      role: data.role,
      customRoleId: data.customRoleId,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
    };
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

  async deleteBinding({
    id,
    organizationId,
    actor,
  }: {
    id: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void> {
    await this.writer.revokeBindings({
      organizationId,
      bindingIds: [id],
      actor,
    });
  }

  async deleteAllMemberships({ groupId }: { groupId: string }): Promise<void> {
    await this.prisma.groupMembership.deleteMany({ where: { groupId } });
  }

  async deleteAllBindings({
    groupId,
    organizationId,
    actor,
  }: {
    groupId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void> {
    await this.writer.revokeBindingsWhere({
      organizationId,
      where: { groupId },
      actor,
      reason: "group deleted",
    });
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

  async areUsersInOrganization({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: string[];
  }): Promise<boolean> {
    if (userIds.length === 0) return true;

    const count = await this.prisma.organizationUser.count({
      where: { organizationId, userId: { in: userIds } },
    });
    return count === userIds.length;
  }

  async anyScopeIsPersonalTeam(
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>,
  ): Promise<boolean> {
    // One definition of "this scope reaches a personal workspace", shared with
    // the role-binding paths.
    return scopesTouchPersonalTeam({ client: this.prisma, scopes });
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
