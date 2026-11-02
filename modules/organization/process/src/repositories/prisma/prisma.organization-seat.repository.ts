import {
  classifyMemberType,
  countMemberSeats,
  type MemberType,
} from "@langwatch/entitlement-contract";
import type { OrganizationMemberSeats } from "@langwatch/organization-contract";
import {
  INVITE_STATUS,
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";
import { z } from "zod";

import type { SeatKind } from "../../rules/seat-holder.rules.ts";
import {
  type OrganizationSeatHolding,
  OrganizationSeatRepository,
} from "../organization-seat.repository.ts";

/** The seat a classified holder takes, in the seat peak's terms. */
const SEAT_OF_MEMBER_TYPE: Record<MemberType, SeatKind> = {
  FullMember: "full",
  LiteMember: "lite",
  Developer: "developer",
};

/** Only what this repository needs, named so a caller never names Prisma's own types. */
type PrismaOrganizationSeatDatabase = PrismaClient | Prisma.TransactionClient;

/** An invitation's team assignments as stored; anything else reads as none. */
const teamAssignmentsSchema = z.array(
  z.looseObject({
    teamId: z.string(),
    role: z.string().optional(),
    customRoleId: z.string().optional(),
  }),
);
type TeamAssignment = z.infer<typeof teamAssignmentsSchema>[number];

const permissionsSchema = z.array(z.string());

/**
 * Context data needed for member classification.
 * Fetched once and shared between getMemberCount and getMembersLiteCount.
 */
interface MemberClassificationContext {
  users: { userId: string; role: OrganizationUserRole }[];
  customRoleMap: Map<string, string[]>;
  userPermissionsMap: Map<string, string[]>;
  pendingInvites: {
    id: string;
    expiresAt: number | null;
    role: OrganizationUserRole;
    teamAssignments: TeamAssignment[] | null;
  }[];
}

/**
 * A membership that holds a seat: a disabled membership and a deactivated person hold no access,
 * so they hold no seat; billing for them would be charging for a locked door.
 * See seat-reconciliation.feature.
 */
const SEAT_HOLDING_MEMBER = { disabledAt: null, user: { deactivatedAt: null } } as const;

/** A pending invitation holds its seat until it expires. */
function seatHoldingInvitation(): Prisma.OrganizationInviteWhereInput {
  return {
    status: INVITE_STATUS.PENDING,
    OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
  };
}

/** Seat counts over organization's own membership and invitation rows. */
export class PrismaOrganizationSeatRepository extends OrganizationSeatRepository {
  static create(prisma: PrismaOrganizationSeatDatabase): PrismaOrganizationSeatRepository {
    return new PrismaOrganizationSeatRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaOrganizationSeatDatabase) {
    super();
  }

  /**
   * Counts full members: ADMIN/MEMBER role, EXTERNAL role with a non-view custom role, or a
   * matching PENDING invite.
   */
  async getMemberCount(organizationId: string): Promise<number> {
    return (await this.countMemberSeats(organizationId)).fullMembers;
  }

  /**
   * Counts Lite Member users: EXTERNAL role with no custom role (or a
   * view-only one), plus PENDING invites meeting the same criteria (not
   * expired, or no expiration).
   */
  async getMembersLiteCount(organizationId: string): Promise<number> {
    return (await this.countMemberSeats(organizationId)).liteMembers;
  }

  /**
   * Counts Developer seats (ADR-171): DEVELOPER users plus live PENDING
   * DEVELOPER invites. Shown on the plan page, never compared to a limit.
   */
  async getMembersDeveloperCount(organizationId: string): Promise<number> {
    return (await this.countMemberSeats(organizationId)).developers;
  }

  /** Every seat in one read: full, lite and Developer, live invitations included. */
  async countMemberSeats(organizationId: string): Promise<OrganizationMemberSeats> {
    const context = await this.getMemberClassificationContext(organizationId);
    return countMemberSeats([
      ...context.users.map((user) => ({
        role: user.role,
        permissions: context.userPermissionsMap.get(user.userId),
      })),
      ...context.pendingInvites.map((invite) => ({
        role: invite.role,
        permissions: this.getInvitePermissions(invite.teamAssignments, context.customRoleMap),
      })),
    ]);
  }

  /** Every holder classified by the rule the counts above use, so the two cannot disagree. */
  async findSeatHolders(organizationId: string): Promise<OrganizationSeatHolding[]> {
    const context = await this.getMemberClassificationContext(organizationId);
    return [
      ...context.users.map((user) => ({
        holder: { kind: "member" as const, userId: user.userId },
        seat: SEAT_OF_MEMBER_TYPE[
          classifyMemberType(user.role, context.userPermissionsMap.get(user.userId))
        ],
      })),
      ...context.pendingInvites.map((invite) => ({
        holder: { kind: "invitation" as const, inviteId: invite.id, expiresAt: invite.expiresAt },
        seat: SEAT_OF_MEMBER_TYPE[
          classifyMemberType(
            invite.role,
            this.getInvitePermissions(invite.teamAssignments, context.customRoleMap),
          )
        ],
      })),
    ];
  }

  /** One member's seat by the rule the count uses; null when they hold none. */
  async findMemberSeat({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<MemberType | null> {
    const user = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId, ...SEAT_HOLDING_MEMBER },
      select: { userId: true, role: true },
    });
    if (user === null) return null;
    if (user.role !== OrganizationUserRole.EXTERNAL) {
      return classifyMemberType(user.role, undefined);
    }
    const permissions = await this.getUserPermissionsMap(
      organizationId,
      [user],
      await this.getCustomRoleMap(organizationId),
    );
    return classifyMemberType(user.role, permissions.get(userId));
  }

  /** One invitation's seat by the rule the count uses; null when it holds none. */
  async findInvitationSeat({
    organizationId,
    inviteId,
  }: {
    organizationId: string;
    inviteId: string;
  }): Promise<MemberType | null> {
    const invite = await this.prisma.organizationInvite.findFirst({
      where: { id: inviteId, organizationId, ...seatHoldingInvitation() },
      select: { role: true, teamAssignments: true },
    });
    if (invite === null) return null;
    const teamAssignments = teamAssignmentsSchema.safeParse(invite.teamAssignments).data ?? null;
    if (teamAssignments === null || teamAssignments.length === 0) {
      return classifyMemberType(invite.role, undefined);
    }
    return classifyMemberType(
      invite.role,
      this.getInvitePermissions(teamAssignments, await this.getCustomRoleMap(organizationId)),
    );
  }

  /**
   * Fetches all data needed for member classification.
   * Shared between getMemberCount and getMembersLiteCount.
   */
  private async getMemberClassificationContext(
    organizationId: string,
  ): Promise<MemberClassificationContext> {
    const users = await this.prisma.organizationUser.findMany({
      where: { organizationId, ...SEAT_HOLDING_MEMBER },
      select: { userId: true, role: true },
    });

    const customRoleMap = await this.getCustomRoleMap(organizationId);
    const userPermissionsMap = await this.getUserPermissionsMap(
      organizationId,
      users,
      customRoleMap,
    );

    const pendingInvites = await this.prisma.organizationInvite.findMany({
      where: { organizationId, ...seatHoldingInvitation() },
      select: { id: true, expiration: true, role: true, teamAssignments: true },
    });

    return {
      users,
      customRoleMap,
      userPermissionsMap,
      pendingInvites: pendingInvites.map((i) => ({
        id: i.id,
        expiresAt: i.expiration ? fromDate(i.expiration).epochMilliseconds : null,
        role: i.role,
        teamAssignments: teamAssignmentsSchema.safeParse(i.teamAssignments).data ?? null,
      })),
    };
  }

  /**
   * Gets custom roles and their permissions for an organization.
   */
  private async getCustomRoleMap(organizationId: string): Promise<Map<string, string[]>> {
    const customRoles = await this.prisma.customRole.findMany({
      where: { organizationId },
      select: { id: true, permissions: true },
    });
    return new Map(
      customRoles.map((r) => [r.id, permissionsSchema.safeParse(r.permissions).data ?? []]),
    );
  }

  /**
   * Builds a map of user ID to their merged permissions from team assignments.
   */
  private async getUserPermissionsMap(
    organizationId: string,
    users: { userId: string; role: OrganizationUserRole }[],
    customRoleMap: Map<string, string[]>,
  ): Promise<Map<string, string[]>> {
    const externalUserIds = users
      .filter((u) => u.role === OrganizationUserRole.EXTERNAL)
      .map((u) => u.userId);

    if (externalUserIds.length === 0) {
      return new Map();
    }

    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true },
    });

    if (teams.length === 0) {
      return new Map();
    }

    const teamIds = teams.map((t) => t.id);
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: { in: teamIds },
        userId: { in: externalUserIds },
      },
      select: { userId: true, customRoleId: true },
    });

    const userPermissionsMap = new Map<string, string[]>();
    for (const binding of bindings) {
      if (binding.customRoleId && binding.userId) {
        const permissions = customRoleMap.get(binding.customRoleId);
        if (permissions) {
          const existing = userPermissionsMap.get(binding.userId) ?? [];
          userPermissionsMap.set(binding.userId, [...existing, ...permissions]);
        }
      }
    }

    return userPermissionsMap;
  }

  /**
   * Gets merged permissions from invite team assignments.
   */
  private getInvitePermissions(
    teamAssignments: TeamAssignment[] | null,
    customRoleMap: Map<string, string[]>,
  ): string[] | undefined {
    if (!teamAssignments) {
      return undefined;
    }

    const allPermissions: string[] = [];
    for (const assignment of teamAssignments) {
      if (assignment.customRoleId) {
        const permissions = customRoleMap.get(assignment.customRoleId);
        if (permissions) {
          allPermissions.push(...permissions);
        }
      }
    }

    return allPermissions.length > 0 ? allPermissions : undefined;
  }
}
