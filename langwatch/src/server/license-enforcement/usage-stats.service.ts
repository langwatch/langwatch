import type { PrismaClient } from "@prisma/client";
import { dependencies } from "../../injection/dependencies.server";
import { TraceUsageService } from "../traces/trace-usage.service";
import {
  type ILicenseEnforcementRepository,
  LicenseEnforcementRepository,
} from "./license-enforcement.repository";
import type { MinimalUser } from "./license-enforcement.service";

/**
 * Interface for trace usage counting.
 * Follows Interface Segregation Principle - only what we need.
 */
export interface ITraceUsageService {
  getCurrentMonthCount(params: { organizationId: string }): Promise<number>;
}

/**
 * Usage statistics result for an organization.
 */
export interface UsageStats {
  projectsCount: number;
  currentMonthMessagesCount: number;
  currentMonthCost: number;
  activePlan: Awaited<
    ReturnType<typeof dependencies.subscriptionHandler.getActivePlan>
  >;
  maxMonthlyUsageLimit: number;
  membersCount: number;
  membersLiteCount: number;
  promptsCount: number;
  workflowsCount: number;
  scenariosCount: number;
  evaluatorsCount: number;
  evaluationsCreditUsed: number;
}

/**
 * Service for retrieving organization usage statistics.
 *
 * Coordinates between:
 * - LicenseEnforcementRepository (Prisma queries)
 * - TraceUsageService (Elasticsearch queries)
 * - SubscriptionHandler (plan info)
 *
 * This is the proper service layer - routers call this instead of
 * manually wiring dependencies.
 */
export class UsageStatsService {
  constructor(
    private readonly repository: ILicenseEnforcementRepository,
    private readonly traceUsageService: ITraceUsageService,
    private readonly subscriptionHandler: typeof dependencies.subscriptionHandler,
  ) {}

  /**
   * Static factory method for creating UsageStatsService with proper DI.
   * Routers should call this instead of manually wiring dependencies.
   */
  static create(prisma: PrismaClient): UsageStatsService {
    const traceUsageService = TraceUsageService.create(prisma);
    const repository = new LicenseEnforcementRepository(prisma);
    return new UsageStatsService(
      repository,
      traceUsageService,
      dependencies.subscriptionHandler,
    );
  }

  /**
   * Gets comprehensive usage statistics for an organization.
   * Aggregates data from multiple sources in parallel.
   */
  async getUsageStats(
    organizationId: string,
    user: MinimalUser,
  ): Promise<UsageStats> {
    const [
      projectsCount,
      currentMonthMessagesCount,
      currentMonthCost,
      activePlan,
      maxMonthlyUsageLimit,
      membersCount,
      membersLiteCount,
      promptsCount,
      workflowsCount,
      scenariosCount,
      evaluatorsCount,
      evaluationsCreditUsed,
    ] = await Promise.all([
      this.repository.getProjectCount(organizationId),
      this.traceUsageService.getCurrentMonthCount({ organizationId }),
      this.repository.getCurrentMonthCost(organizationId),
      this.subscriptionHandler.getActivePlan(organizationId, user),
      this.getMaxMonthlyUsageLimit(organizationId),
      this.repository.getMemberCount(organizationId),
      this.repository.getMembersLiteCount(organizationId),
      this.repository.getPromptCount(organizationId),
      this.repository.getWorkflowCount(organizationId),
      this.repository.getScenarioCount(organizationId),
      this.repository.getEvaluatorCount(organizationId),
      this.repository.getEvaluationsCreditUsed(organizationId),
    ]);

    return {
      projectsCount,
      currentMonthMessagesCount,
      currentMonthCost,
      activePlan,
      maxMonthlyUsageLimit,
      membersCount,
      membersLiteCount,
      promptsCount,
      workflowsCount,
      scenariosCount,
      evaluatorsCount,
      evaluationsCreditUsed,
    };
  }

  /**
   * Get the maximum monthly usage limit for the organization.
   * FIXME: This was recently changed to return Infinity,
   * but still takes the organizationId as a parameter.
   *
   * Either we remove the organizationId parameter from all the calls to this function,
   * or we use to get the plan and return it correctly.
   */
  private async getMaxMonthlyUsageLimit(
    _organizationId: string,
  ): Promise<number> {
    return Infinity;
  }
}
