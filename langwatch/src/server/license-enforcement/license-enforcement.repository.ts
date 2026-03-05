import {
  INVITE_STATUS,
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { getCurrentMonthStart } from "../utils/dateUtils";
import {
  isFullMember,
  isLiteMember,
  isViewOnlyCustomRole,
} from "./member-classification";

// Re-export classification functions for backwards compatibility
export {
  isViewOnlyPermission,
  isViewOnlyCustomRole,
  classifyMemberType,
  isFullMember,
  isLiteMember,
} from "./member-classification";

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
 * Minimal interface for cost checking operations.
 * Follows Interface Segregation Principle - callers only depend on what they need.
 * Used by workers and API routes that just need to check cost limits.
 */
export interface ICostChecker {
  getCurrentMonthCost(organizationId: string): Promise<number>;
  maxMonthlyUsageLimit(organizationId: string): Promise<number>;
}

/**
 * Factory function to create a minimal cost checker.
 * Used by callers that only need cost checking (evaluate.ts, evaluationsWorker.ts, topicClustering.ts).
 */
export function createCostChecker(prisma: PrismaClient): ICostChecker {
  const repository = new LicenseEnforcementRepository(prisma);
  return {
    getCurrentMonthCost: (organizationId: string) =>
      repository.getCurrentMonthCost(organizationId),
    /**
     * Get the maximum monthly usage limit for the organization.
     * FIXME: This was recently changed to return Infinity,
     * but still takes the organizationId as a parameter.
     *
     * Either we remove the organizationId parameter from all the calls to this function,
     * or we use to get the plan and return it correctly.
     */
    maxMonthlyUsageLimit: (_organizationId: string) => Promise.resolve(Infinity),
  };
}

/**
 * Repository interface for license enforcement.
 * Defines the contract for counting resources - allows for easy testing
 * and follows Dependency Inversion Principle (DIP).
 *
 * Note: Message/trace counting is NOT included here because it queries
 * Elasticsearch (via TraceUsageService), not Prisma. Repositories should
 * only do database queries - delegation to other services violates SRP.
 */
export interface ILicenseEnforcementRepository {
  getWorkflowCount(organizationId: string): Promise<number>;
  getPromptCount(organizationId: string): Promise<number>;
  getEvaluatorCount(organizationId: string): Promise<number>;
  getActiveScenarioCount(organizationId: string): Promise<number>;
  getProjectCount(organizationId: string): Promise<number>;
  getTeamCount(organizationId: string): Promise<number>;
  getMemberCount(organizationId: string): Promise<number>;
  getMembersLiteCount(organizationId: string): Promise<number>;
  getAgentCount(organizationId: string): Promise<number>;
  getExperimentCount(organizationId: string): Promise<number>;
  getOnlineEvaluationCount(organizationId: string): Promise<number>;
  getDatasetCount(organizationId: string): Promise<number>;
  getDashboardCount(organizationId: string): Promise<number>;
  getCustomGraphCount(organizationId: string): Promise<number>;
  getAutomationCount(organizationId: string): Promise<number>;
  getEvaluationsCreditUsed(organizationId: string): Promise<number>;
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
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  /**
   * Counts active (non-archived) workflows for license enforcement.
   * Only active workflows count against the license limit.
   */
  async getWorkflowCount(organizationId: string): Promise<number> {
    return this.prisma.workflow.count({
      where: {
        project: { team: { organizationId } },
        archivedAt: null,
      },
    });
  }

  /**
   * Counts all prompts for license enforcement.
   * Prompts do not support archival - all prompts count against limits.
   */
  async getPromptCount(organizationId: string): Promise<number> {
    return this.prisma.llmPromptConfig.count({
      where: { project: { team: { organizationId } } },
    });
  }

  /**
   * Counts active (non-archived) evaluators for license enforcement.
   */
  async getEvaluatorCount(organizationId: string): Promise<number> {
    return this.prisma.evaluator.count({
      where: {
        project: { team: { organizationId } },
        archivedAt: null,
      },
    });
  }

  /**
   * Counts active (non-archived) scenarios for license enforcement.
   * Only active scenarios count against the license limit.
   */
  async getActiveScenarioCount(organizationId: string): Promise<number> {
    return this.prisma.scenario.count({
      where: {
        project: { team: { organizationId } },
        archivedAt: null,
      },
    });
  }

  /**
   * Counts all projects in organization.
   */
  async getProjectCount(organizationId: string): Promise<number> {
    return this.prisma.project.count({
      where: { team: { organizationId } },
    });
  }

  /**
   * Counts teams in organization.
   */
  async getTeamCount(organizationId: string): Promise<number> {
    return this.prisma.team.count({
      where: { organizationId },
    });
  }

  /**
   * Counts full members in organization:
   * - Users with ADMIN or MEMBER org role
   * - Users with EXTERNAL role BUT have a custom role with ANY non-view permission
   * - PENDING and WAITING_APPROVAL invites (not expired, or no expiration) with ADMIN or MEMBER role
   * - PENDING and WAITING_APPROVAL invites with custom role that has non-view permissions
   */
  async getMemberCount(organizationId: string): Promise<number> {
    const context = await this.getMemberClassificationContext(organizationId);
    return this.countMembersByType(context, isFullMember);
  }

  /**
   * Counts Lite Member users in organization:
   * - Users with EXTERNAL role AND (no custom role OR view-only custom role)
   * - PENDING and WAITING_APPROVAL invites (not expired, or no expiration) with EXTERNAL role AND (no custom role OR view-only custom role)
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
    organizationId: string
  ): Promise<MemberClassificationContext> {
    const users = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true, role: true },
    });

    const customRoleMap = await this.getCustomRoleMap(organizationId);
    const userPermissionsMap = await this.getUserPermissionsMap(
      organizationId,
      users,
      customRoleMap
    );

    const pendingInvites = await this.prisma.organizationInvite.findMany({
      where: {
        organizationId,
        status: { in: [INVITE_STATUS.PENDING, INVITE_STATUS.WAITING_APPROVAL] },
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
    organizationId: string
  ): Promise<Map<string, string[]>> {
    const customRoles = await this.prisma.customRole.findMany({
      where: { organizationId },
      select: { id: true, permissions: true },
    });
    return new Map(customRoles.map((r) => [r.id, r.permissions as string[]]));
  }

  /**
   * Builds a map of user ID to their merged permissions from team assignments.
   */
  private async getUserPermissionsMap(
    organizationId: string,
    users: { userId: string; role: OrganizationUserRole }[],
    customRoleMap: Map<string, string[]>
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

    const teamUsers = await this.prisma.teamUser.findMany({
      where: {
        teamId: { in: teams.map((t) => t.id) },
        userId: { in: externalUserIds },
      },
      select: { userId: true, assignedRoleId: true },
    });

    const userPermissionsMap = new Map<string, string[]>();
    for (const tu of teamUsers) {
      if (tu.assignedRoleId) {
        const permissions = customRoleMap.get(tu.assignedRoleId);
        if (permissions) {
          const existing = userPermissionsMap.get(tu.userId) ?? [];
          userPermissionsMap.set(tu.userId, [...existing, ...permissions]);
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
      permissions: string[] | undefined
    ) => boolean
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
        context.customRoleMap
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
    customRoleMap: Map<string, string[]>
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
   * Counts active (non-archived) agents for license enforcement.
   * Only active agents count against the license limit.
   *
   * Note: Agent model has RLS policy requiring direct projectId filter,
   * so we first get project IDs then filter by them.
   */
  async getAgentCount(organizationId: string): Promise<number> {
    const projectIds = await this.getProjectIds(organizationId);
    if (projectIds.length === 0) return 0;

    return this.prisma.agent.count({
      where: {
        projectId: { in: projectIds },
        archivedAt: null,
      },
    });
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
   * Counts all experiments for license enforcement.
   * Experiments do not support archival - all experiments count against limits.
   *
   * Note: Experiment model has RLS policy requiring direct projectId filter,
   * so we first get project IDs then filter by them.
   */
  async getExperimentCount(organizationId: string): Promise<number> {
    const projectIds = await this.getProjectIds(organizationId);
    if (projectIds.length === 0) return 0;

    return this.prisma.experiment.count({
      where: {
        projectId: { in: projectIds },
      },
    });
  }

  /**
   * Counts all online evaluations (monitors) for license enforcement.
   * All monitors count against the license limit regardless of enabled state.
   *
   * Note: Monitor model has RLS policy requiring direct projectId filter,
   * so we first get project IDs then filter by them.
   */
  async getOnlineEvaluationCount(organizationId: string): Promise<number> {
    const projectIds = await this.getProjectIds(organizationId);
    if (projectIds.length === 0) return 0;

    return this.prisma.monitor.count({
      where: {
        projectId: { in: projectIds },
      },
    });
  }

  /**
   * Counts active (non-archived) datasets for license enforcement.
   * Only active datasets count against the license limit.
   *
   * Note: Dataset model has RLS policy requiring direct projectId filter,
   * so we first get project IDs then filter by them.
   */
  async getDatasetCount(organizationId: string): Promise<number> {
    const projectIds = await this.getProjectIds(organizationId);
    if (projectIds.length === 0) return 0;

    return this.prisma.dataset.count({
      where: {
        projectId: { in: projectIds },
        archivedAt: null,
      },
    });
  }

  /**
   * Counts all dashboards for license enforcement.
   * Dashboards do not support archival - all dashboards count against limits.
   *
   * Note: Dashboard model has RLS policy requiring direct projectId filter,
   * so we first get project IDs then filter by them.
   */
  async getDashboardCount(organizationId: string): Promise<number> {
    const projectIds = await this.getProjectIds(organizationId);
    if (projectIds.length === 0) return 0;

    return this.prisma.dashboard.count({
      where: {
        projectId: { in: projectIds },
      },
    });
  }

  /**
   * Counts all custom graphs for license enforcement.
   * Custom graphs do not support archival - all graphs count against limits.
   *
   * Note: CustomGraph model has RLS policy requiring direct projectId filter,
   * so we first get project IDs then filter by them.
   */
  async getCustomGraphCount(organizationId: string): Promise<number> {
    const projectIds = await this.getProjectIds(organizationId);
    if (projectIds.length === 0) return 0;

    return this.prisma.customGraph.count({
      where: {
        projectId: { in: projectIds },
      },
    });
  }

  /**
   * Counts active (non-deleted) automations for license enforcement.
   * Only active automations count against the license limit.
   *
   * Note: Trigger model has RLS policy requiring direct projectId filter,
   * so we first get project IDs then filter by them.
   */
  async getAutomationCount(organizationId: string): Promise<number> {
    const projectIds = await this.getProjectIds(organizationId);
    if (projectIds.length === 0) return 0;

    return this.prisma.trigger.count({
      where: {
        projectId: { in: projectIds },
        deleted: false,
      },
    });
  }

  /**
   * Counts evaluations credit used for the current month.
   * Counts BatchEvaluation records created since the start of the month.
   */
  async getEvaluationsCreditUsed(organizationId: string): Promise<number> {
    const startOfMonth = getCurrentMonthStart();
    return this.prisma.batchEvaluation.count({
      where: {
        project: { team: { organizationId } },
        createdAt: { gte: startOfMonth },
      },
    });
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
