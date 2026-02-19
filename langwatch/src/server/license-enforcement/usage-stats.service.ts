import type { PrismaClient } from "@prisma/client";
import { SubscriptionHandler } from "~/server/subscriptionHandler";
import { formatNumber, formatPercent } from "../../utils/formatNumber";
import { getApp } from "../app-layer/app";
import {
  type ILicenseEnforcementRepository,
  LicenseEnforcementRepository,
} from "./license-enforcement.repository";
import type { MinimalUser } from "./license-enforcement.service";

/** Threshold at which to show a warning (80% of limit) */
export const MESSAGE_LIMIT_WARNING_THRESHOLD = 0.8;

/** Alert levels for message usage */
export type MessageLimitStatus = "ok" | "warning" | "exceeded";

/** Pre-formatted message limit info for frontend display */
export interface MessageLimitInfo {
  status: MessageLimitStatus;
  current: number;
  max: number;
  currentFormatted: string;
  maxFormatted: string;
  percentageFormatted: string;
  message: string;
}

/**
 * Calculates the message limit status based on current usage and max allowed.
 */
export function getMessageLimitStatus(
  current: number,
  max: number,
): MessageLimitStatus {
  if (max === 0 || max === Number.MAX_SAFE_INTEGER) return "ok";
  if (current >= max) return "exceeded";
  if (current >= max * MESSAGE_LIMIT_WARNING_THRESHOLD) return "warning";
  return "ok";
}

/**
 * Builds the complete message limit info with pre-formatted values.
 */
export function buildMessageLimitInfo(
  current: number,
  max: number,
): MessageLimitInfo {
  const percentage = max > 0 ? current / max : 0;
  const status = getMessageLimitStatus(current, max);
  const currentFormatted = formatNumber(current);
  const maxFormatted = formatNumber(max);
  const percentageFormatted = formatPercent(percentage);

  const message =
    status === "exceeded"
      ? `You reached the limit of ${maxFormatted} messages for this month, new messages will not be processed.`
      : `You have used ${percentageFormatted} of your monthly message limit (${currentFormatted} / ${maxFormatted}).`;

  return {
    status,
    current,
    max,
    currentFormatted,
    maxFormatted,
    percentageFormatted,
    message,
  };
}

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
    ReturnType<typeof SubscriptionHandler.getActivePlan>
  >;
  maxMonthlyUsageLimit: number;
  membersCount: number;
  membersLiteCount: number;
  teamsCount: number;
  promptsCount: number;
  workflowsCount: number;
  scenariosCount: number;
  evaluatorsCount: number;
  agentsCount: number;
  experimentsCount: number;
  evaluationsCreditUsed: number;
  messageLimitInfo: MessageLimitInfo;
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
    private readonly subscriptionHandler: typeof SubscriptionHandler,
  ) {}

  /**
   * Static factory method for creating UsageStatsService with proper DI.
   * Routers should call this instead of manually wiring dependencies.
   */
  static create(prisma: PrismaClient): UsageStatsService {
    const repository = new LicenseEnforcementRepository(prisma);
    return new UsageStatsService(
      repository,
      getApp().usage,
      SubscriptionHandler,
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
      teamsCount,
      promptsCount,
      workflowsCount,
      scenariosCount,
      evaluatorsCount,
      agentsCount,
      experimentsCount,
      evaluationsCreditUsed,
    ] = await Promise.all([
      this.repository.getProjectCount(organizationId),
      this.traceUsageService.getCurrentMonthCount({ organizationId }),
      this.repository.getCurrentMonthCost(organizationId),
      this.subscriptionHandler.getActivePlan(organizationId, user),
      this.getMaxMonthlyUsageLimit(organizationId),
      this.repository.getMemberCount(organizationId),
      this.repository.getMembersLiteCount(organizationId),
      this.repository.getTeamCount(organizationId),
      this.repository.getPromptCount(organizationId),
      this.repository.getWorkflowCount(organizationId),
      this.repository.getActiveScenarioCount(organizationId),
      this.repository.getEvaluatorCount(organizationId),
      this.repository.getAgentCount(organizationId),
      this.repository.getExperimentCount(organizationId),
      this.repository.getEvaluationsCreditUsed(organizationId),
    ]);

    const messageLimitInfo = buildMessageLimitInfo(
      currentMonthMessagesCount,
      activePlan.maxMessagesPerMonth,
    );

    return {
      projectsCount,
      currentMonthMessagesCount,
      currentMonthCost,
      activePlan,
      maxMonthlyUsageLimit,
      membersCount,
      membersLiteCount,
      teamsCount,
      promptsCount,
      workflowsCount,
      scenariosCount,
      evaluatorsCount,
      agentsCount,
      experimentsCount,
      evaluationsCreditUsed,
      messageLimitInfo,
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
