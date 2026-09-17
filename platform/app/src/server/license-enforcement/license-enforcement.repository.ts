import {
  INVITE_STATUS,
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
} from "~/generated/prisma/client";
import { parseCustomRolePermissions } from "~/server/app-layer/authz/custom-role-permissions";
import { GrantsAccessListingRepository } from "~/server/app-layer/authz/repositories/access-listing.grants.repository";
import { liveRoles } from "~/server/app-layer/authz/repositories/live-rows";
import { getCurrentMonthStart } from "../utils/dateUtils";
import { isFullMember, isLiteMember } from "./member-classification";

/**
 * Type for team assignment in organization invites.
 */
interface TeamAssignment {
  teamId: string;
  role?: string;
  customRoleId?: string;
}

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

/**
 * Repository interface for license enforcement.
 * Defines the contract for counting resources - allows for easy testing
 * and follows Dependency Inversion Principle (DIP).
 *
 * Note: Message/trace counting is NOT included here because it queries
 * ClickHouse (via TraceUsageService), not Prisma. Repositories should
 * only do database queries - delegation to other services violates SRP.
 */
export interface ILicenseEnforcementRepository {
  getMemberCount(organizationId: string): Promise<number>;
  getMembersLiteCount(organizationId: string): Promise<number>;
  getCurrentMonthCost(organizationId: string): Promise<number>;
  getCurrentMonthCostForProjects(projectIds: string[]): Promise<number>;
}

/**
 * Repository implementation for counting resources per organization.
 * Pure data access layer - only Prisma queries, no business logic.
 */
export class LicenseEnforcementRepository
  implements ILicenseEnforcementRepository
{
  private readonly accessListing: GrantsAccessListingRepository;

  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {
    this.accessListing = new GrantsAccessListingRepository(prisma);
  }

  /**
   * Counts full members in organization:
   * - Users with ADMIN or MEMBER org role
   * - Users with EXTERNAL role BUT have a custom role with ANY non-view permission
   * - PENDING invites (not expired, or no expiration) with ADMIN or MEMBER role
   * - PENDING invites with custom role that has non-view permissions
   */
  async getMemberCount(organizationId: string): Promise<number> {
    const context = await this.getMemberClassificationContext(organizationId);
    return this.countMembersByType(context, isFullMember);
  }

  /**
   * Counts Lite Member users in organization:
   * - Users with EXTERNAL role AND (no custom role OR view-only custom role)
   * - PENDING invites (not expired, or no expiration) with EXTERNAL role AND (no custom role OR view-only custom role)
   */
  async getMembersLiteCount(organizationId: string): Promise<number> {
    const context = await this.getMemberClassificationContext(organizationId);
    return this.countMembersByType(context, isLiteMember);
  }

  /**
   * Fetches all data needed for member classification.
   * Shared between getMemberCount and getMembersLiteCount.
   */
  private async getMemberClassificationContext(
    organizationId: string,
  ): Promise<MemberClassificationContext> {
    // A SEAT IS SOMEBODY WHO CAN SIGN IN, which is two conditions and not
    // one. Disabled memberships are out of the pool by definition: they hold
    // no access, so billing for them would be charging for a locked door. A
    // DEACTIVATED person is behind the same locked door and was still being
    // billed - and that is the state a directory puts a leaver in, because
    // `active: false` is what Okta and Entra send when somebody leaves, not
    // `DELETE`. So an organization went on paying for everybody its identity
    // provider had already offboarded, which is the one thing this feature
    // promises never to do. `refuseIfItClosesTheOrganization` in the SCIM
    // service counts "able to sign in" the same way, for the same reason.
    // See seat-reconciliation.feature.
    const users = await this.prisma.organizationUser.findMany({
      where: {
        organizationId,
        disabledAt: null,
        user: { deactivatedAt: null },
      },
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
        teamAssignments: i.teamAssignments as TeamAssignment[] | null,
      })),
    };
  }

  /**
   * Gets custom roles and their permissions for an organization.
   */
  private async getCustomRoleMap(
    organizationId: string,
  ): Promise<Map<string, string[]>> {
    const customRoles = await liveRoles(this.prisma).findMany({
      where: { organizationId },
      select: { id: true, permissions: true },
    });
    return new Map(
      customRoles.map((role) => [
        role.id,
        parseCustomRolePermissions({
          customRoleId: role.id,
          permissions: role.permissions,
        }),
      ]),
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
    const bindings = await this.accessListing.findBindingRows({
      organizationId,
      where: {
        principalType: "USER",
        principalId: { in: externalUserIds },
        scopeType: "TEAM",
        scopeId: { in: teamIds },
        roleKey: { startsWith: "custom:" },
      },
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
    predicate: (
      role: OrganizationUserRole,
      permissions: string[] | undefined,
    ) => boolean,
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
      const permissions = this.getInvitePermissions(
        invite.teamAssignments,
        context.customRoleMap,
      );
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

  /**
   * Helper to get all project IDs for an organization.
   * Used by methods that need to query models with RLS policies.
   */
  private async getProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  /**
   * Gets current month cost for an organization.
   * Aggregates costs across all projects in the organization.
   */
  async getCurrentMonthCost(organizationId: string): Promise<number> {
    const projectIds = (
      await this.prisma.project.findMany({
        where: { team: { organizationId } },
        select: { id: true },
      })
    ).map((project) => project.id);

    return this.getCurrentMonthCostForProjects(projectIds);
  }

  /**
   * Gets current month cost for a list of projects.
   */
  async getCurrentMonthCostForProjects(projectIds: string[]): Promise<number> {
    return (
      (
        await this.prisma.cost.aggregate({
          where: {
            projectId: { in: projectIds },
            createdAt: { gte: getCurrentMonthStart() },
          },
          _sum: { amount: true },
        })
      )._sum?.amount ?? 0
    );
  }
}
