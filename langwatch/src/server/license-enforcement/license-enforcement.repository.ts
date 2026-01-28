import { OrganizationUserRole, type PrismaClient } from "@prisma/client";
import { getCurrentMonthStart } from "../utils/dateUtils";

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
  getScenarioCount(organizationId: string): Promise<number>;
  getProjectCount(organizationId: string): Promise<number>;
  getMemberCount(organizationId: string): Promise<number>;
  getMembersLiteCount(organizationId: string): Promise<number>;
  getAgentCount(organizationId: string): Promise<number>;
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
  constructor(private readonly prisma: PrismaClient) {}

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
   * Counts all scenarios for license enforcement.
   * Scenarios do not support archival - all count against limits.
   */
  async getScenarioCount(organizationId: string): Promise<number> {
    return this.prisma.scenario.count({
      where: { project: { team: { organizationId } } },
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
   * Counts all members in organization.
   */
  async getMemberCount(organizationId: string): Promise<number> {
    return this.prisma.organizationUser.count({
      where: { organizationId },
    });
  }

  /**
   * Counts lite members in organization.
   * Lite members are users with EXTERNAL role.
   */
  async getMembersLiteCount(organizationId: string): Promise<number> {
    return this.prisma.organizationUser.count({
      where: { organizationId, role: OrganizationUserRole.EXTERNAL },
    });
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
