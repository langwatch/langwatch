import type { LedgerActor } from "@langwatch/actor";
import {
  type Group,
  type GroupMembership,
  type PrismaClient,
  type RoleBinding,
  RoleBindingScopeType,
} from "~/generated/prisma/client";
import {
  AuthzLedgerUnavailableError,
  type GrantsLedgerWriter,
  grantsLedgerWriter,
  newGroupMembershipId,
} from "~/server/app-layer/authz/ledger";
import { CutoverAwareAccessListingRepository } from "~/server/app-layer/authz/repositories/access-listing.cutover.repository";
import type {
  AccessListingBindingRow,
  AccessListingRepository,
} from "~/server/app-layer/authz/repositories/access-listing.repository";
import {
  LIVE_MEMBERSHIP,
  liveGroupMemberships,
} from "~/server/app-layer/authz/repositories/live-rows";
import { scopesTouchPersonalTeam } from "~/server/role-bindings/personal-team-scope";
import { MemberNotInGroupError } from "../errors";
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
    private readonly accessListing: AccessListingRepository = new CutoverAwareAccessListingRepository(
      prisma,
    ),
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
              // LIVE members only: a group somebody left must not read as one
              // seat larger than the access it confers.
              members: {
                where: {
                  ...LIVE_MEMBERSHIP,
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
            ...LIVE_MEMBERSHIP,
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
    // The group ROW is not a grant fact, so it keeps its own write. Its
    // memberships are — a membership is what makes every grant the group
    // carries reach a person — so they leave the transaction and become one
    // command each, exactly as the bindings below do. The comment this
    // replaces said memberships were "not grant facts"; that was the
    // assumption ADR-125 named as the blocking one.
    const created = await this.prisma.group.create({ data: group });

    if (memberIds.length > 0) {
      await this.writer.addGroupMembers({
        organizationId: group.organizationId,
        memberships: memberIds.map((userId) => ({
          membershipId: newGroupMembershipId(),
          groupId: created.id,
          userId,
        })),
        actor,
        onDuplicate: "skip",
      });
    }

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
    return liveGroupMemberships(this.prisma).findMany({
      where: { groupId },
      select: {
        userId: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * One membership, through the ledger. `onDuplicate: "reject"` is what turns
   * "they are already in this group" into the 409 the REST contract froze,
   * and the writer's own liveness pre-check is what makes a re-add after a
   * removal succeed rather than collide with the marked row.
   */
  async addMember({
    groupId,
    organizationId,
    userId,
    actor,
  }: {
    groupId: string;
    organizationId: string;
    userId: string;
    actor: LedgerActor;
  }): Promise<GroupMembership> {
    const membershipId = newGroupMembershipId();
    await this.writer.addGroupMembers({
      organizationId,
      memberships: [{ membershipId, groupId, userId }],
      actor,
      onDuplicate: "reject",
    });
    // The row the fold wrote, read back through the fence. The writer waited
    // for the projection, so it is there; if the wait timed out the append is
    // still durable and the caller is told so rather than handed a row that
    // does not exist yet.
    const row = await liveGroupMemberships(this.prisma).findFirst({
      where: { id: membershipId },
    });
    if (!row) throw new AuthzLedgerUnavailableError();
    return row;
  }

  async removeMember({
    groupId,
    organizationId,
    userId,
    actor,
  }: {
    groupId: string;
    organizationId: string;
    userId: string;
    actor: LedgerActor;
  }): Promise<void> {
    // The LIVE membership, because that is the only one there is anything to
    // end. A pair whose membership already ended has a row, and answering
    // "removed" for it would report a change that did not happen.
    const live = await liveGroupMemberships(this.prisma).findFirst({
      where: { groupId, userId, group: { organizationId } },
      select: { id: true },
    });
    if (!live) throw new MemberNotInGroupError(userId);
    await this.writer.removeGroupMembers({
      organizationId,
      memberships: [{ membershipId: live.id, groupId, userId }],
      actor,
      reason: "removed from group",
    });
  }

  async findBindings({
    organizationId,
    groupId,
  }: {
    organizationId: string;
    groupId: string;
  }): Promise<AccessListingBindingRow[]> {
    // Through the per-organization fork (ADR-092, delivery-plan PR 3
    // follow-up): a cut-over organization's group page is served from the
    // ledger's own head. The organization now bounds the read, too - the
    // route has already proven the group belongs to it.
    return this.accessListing.findGroupBindings({ organizationId, groupId });
  }

  async createBinding({
    data,
    actor,
  }: {
    data: CreateBindingInput;
    actor: LedgerActor;
  }): Promise<CreatedBinding> {
    // "reject", not "skip": the returned id is the caller-minted one, so a
    // skipped duplicate would hand back an id for a row that was never
    // created. The service maps `DuplicateBindingError` to the 409 conflict.
    await this.writer.attachBindings({
      organizationId: data.organizationId,
      bindings: [attachFor(data)],
      actor,
      onDuplicate: "reject",
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
      reason: "group binding removed",
    });
  }

  /**
   * End every live membership of the group, as facts.
   *
   * A `deleteMany` here erased who had been in the group and when they left,
   * which is precisely the answer the ledger exists to keep. The rows are
   * marked instead, and the events behind them name the pair — so the record
   * survives even the group row's own deletion, which still cascades the
   * projection rows away (see the `GroupMembership` model comment).
   */
  async deleteAllMemberships({
    groupId,
    organizationId,
    actor,
  }: {
    groupId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void> {
    await this.writer.removeGroupMembersWhere({
      organizationId,
      where: { groupId },
      actor,
      reason: "group deleted",
    });
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
