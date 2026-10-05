import { isDeveloper, isFullMember, isLiteMember } from "@langwatch/entitlement-contract";
import {
  INVITE_STATUS,
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "@langwatch/prisma-client/generated";
import { z } from "zod";

import { OrganizationSeatRepository } from "../organization-seat.repository.ts";

/** Only what this repository needs, named so a caller never names Prisma's own types. */
export type PrismaOrganizationSeatDatabase = PrismaClient | Prisma.TransactionClient;

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
    role: OrganizationUserRole;
    teamAssignments: TeamAssignment[] | null;
  }[];
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
    const context = await this.getMemberClassificationContext(organizationId);
    return this.countMembersByType(context, isFullMember);
  }

  /**
   * Counts Lite Member users: EXTERNAL role with no custom role (or a
   * view-only one), plus PENDING invites meeting the same criteria (not
   * expired, or no expiration).
   */
  async getMembersLiteCount(organizationId: string): Promise<number> {
    const context = await this.getMemberClassificationContext(organizationId);
    return this.countMembersByType(context, isLiteMember);
  }

  /**
   * Counts Developer seats (ADR-171): DEVELOPER users plus live PENDING
   * DEVELOPER invites. Shown on the plan page, never compared to a limit.
   */
  async getMembersDeveloperCount(organizationId: string): Promise<number> {
    const context = await this.getMemberClassificationContext(organizationId);
    return this.countMembersByType(context, isDeveloper);
  }

  /**
   * Fetches all data needed for member classification.
   * Shared between getMemberCount and getMembersLiteCount.
   */
  private async getMemberClassificationContext(
    organizationId: string,
  ): Promise<MemberClassificationContext> {
    // A disabled membership and a deactivated person hold no access, so they
    // hold no seat: billing for them would be charging for a locked door.
    // See seat-reconciliation.feature.
    const users = await this.prisma.organizationUser.findMany({
      where: { organizationId, disabledAt: null, user: { deactivatedAt: null } },
      select: { userId: true, role: true },
    });

    const customRoleMap = await this.getCustomRoleMap(organizationId);
    const userPermissionsMap = await this.getUserPermissionsMap(
      organizationId,
      users,
      customRoleMap,
    );

    const pendingInvites = await this.prisma.organizationInvite.findMany({
      where: {
        organizationId,
        status: INVITE_STATUS.PENDING,
        OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
      },
      select: { role: true, teamAssignments: true },
    });

    return {
      users,
      customRoleMap,
      userPermissionsMap,
      pendingInvites: pendingInvites.map((i) => ({
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
   * Counts members matching a classification predicate.
   */
  private countMembersByType(
    context: MemberClassificationContext,
    predicate: (role: OrganizationUserRole, permissions: string[] | undefined) => boolean,
  ): number {
    let count = 0;

    // Count from existing users
    for (const user of context.users) {
      const permissions = context.userPermissionsMap.get(user.userId);
      if (predicate(user.role, permissions)) {
        count++;
      }
    }

    // Count from pending invites
    for (const invite of context.pendingInvites) {
      const permissions = this.getInvitePermissions(invite.teamAssignments, context.customRoleMap);
      if (predicate(invite.role, permissions)) {
        count++;
      }
    }

    return count;
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
