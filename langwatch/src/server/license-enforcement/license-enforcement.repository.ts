import { OrganizationUserRole, type PrismaClient } from "@prisma/client";
import { getCurrentMonthStart } from "../utils/dateUtils";

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
  getEvaluationsCreditUsed(organizationId: string): Promise<number>;
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
}
