import type { PrismaClient } from "@prisma/client";
import { UNLIMITED_MESSAGES } from "../../../ee/billing/planLimits";
import type { PlanInfo } from "../../../ee/licensing/planInfo";
import { formatNumber, formatPercent } from "../../utils/formatNumber";
import { getApp } from "../app-layer/app";
import type { PlanProvider } from "../app-layer/subscription/plan-provider";
import type { UsageUnit } from "../app-layer/usage/usage-meter-policy";
import { USAGE_UNKNOWN, type UsageCount } from "../traces/usage-count";
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
  if (max === 0 || max === Number.MAX_SAFE_INTEGER || max >= UNLIMITED_MESSAGES)
    return "ok";
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
  const status = getMessageLimitStatus(current, max);
  const currentFormatted = formatNumber(current);
  const isUnlimited = max >= UNLIMITED_MESSAGES;
  const maxFormatted = isUnlimited ? "Unlimited" : formatNumber(max);
  const percentage = max > 0 && !isUnlimited ? current / max : 0;
  const percentageFormatted = formatPercent(percentage);

  const message = isUnlimited
    ? `You have used ${currentFormatted} messages this month (Unlimited plan).`
    : status === "exceeded"
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
  getCurrentMonthCount(params: {
    organizationId: string;
  }): Promise<UsageCount | "unlimited">;
  /**
   * Real current-month usage count for display, computed even for unlimited
   * (seat-based / metered) plans where getCurrentMonthCount returns "unlimited".
   *
   * {@link USAGE_UNKNOWN} when the counting store could not answer — the usage
   * page has to be able to tell that apart from a genuine zero.
   */
  getCurrentMonthCountForDisplay(params: {
    organizationId: string;
  }): Promise<UsageCount>;
}

/**
 * Interface for resolving the usage unit (traces or events).
 * Follows Interface Segregation Principle.
 */
export interface IUsageUnitResolver {
  getResolvedUsageUnit(params: { organizationId: string }): Promise<UsageUnit>;
}

/**
 * Usage statistics result for an organization.
 */
export interface UsageStats {
  currentMonthMessagesCount: number | null;
  currentMonthCost: number;
  activePlan: PlanInfo;
  maxMonthlyUsageLimit: number;
  membersCount: number;
  membersLiteCount: number;
  messageLimitInfo: MessageLimitInfo;
  usageUnit: UsageUnit;
}

/**
 * Service for retrieving organization usage statistics.
 *
 * Coordinates between:
 * - LicenseEnforcementRepository (Prisma queries)
 * - UsageService (orchestrated counting via meter policy)
 * - PlanProvider (plan info)
 *
 * This is the proper service layer - routers call this instead of
 * manually wiring dependencies.
 */
export class UsageStatsService {
  private readonly repository: ILicenseEnforcementRepository;
  private readonly traceUsageService: ITraceUsageService;
  private readonly planProvider: PlanProvider;
  private readonly usageUnitResolver: IUsageUnitResolver;

  constructor({
    repository,
    traceUsageService,
    planProvider,
    usageUnitResolver,
  }: {
    repository: ILicenseEnforcementRepository;
    traceUsageService: ITraceUsageService;
    planProvider: PlanProvider;
    usageUnitResolver: IUsageUnitResolver;
  }) {
    this.repository = repository;
    this.traceUsageService = traceUsageService;
    this.planProvider = planProvider;
    this.usageUnitResolver = usageUnitResolver;
  }

  /**
   * Static factory method for creating UsageStatsService with proper DI.
   * Routers should call this instead of manually wiring dependencies.
   */
  static create(prisma: PrismaClient): UsageStatsService {
    const repository = new LicenseEnforcementRepository(prisma);
    return new UsageStatsService({
      repository,
      traceUsageService: getApp().usage,
      planProvider: getApp().planProvider,
      usageUnitResolver: getApp().usage,
    });
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
      currentMonthMessagesCount,
      currentMonthCost,
      activePlan,
      maxMonthlyUsageLimit,
      membersCount,
      membersLiteCount,
      usageUnit,
    ] = await Promise.all([
      this.traceUsageService.getCurrentMonthCountForDisplay({ organizationId }),
      this.repository.getCurrentMonthCost(organizationId),
      this.planProvider.getActivePlan({ organizationId, user }),
      this.getMaxMonthlyUsageLimit(organizationId),
      this.repository.getMemberCount(organizationId),
      this.repository.getMembersLiteCount(organizationId),
      this.usageUnitResolver.getResolvedUsageUnit({ organizationId }),
    ]);

    // Real metered/trace volume for the month — surfaced even for unlimited
    // (seat-based) plans so the usage page shows actual billable events.
    //
    // `null` when the counting store could not answer. That is what the
    // `number | null` on UsageStats was always for, and it is the difference
    // between a page saying "we can't show this right now" and one asserting
    // that a busy organization sent nothing this month.
    const resolvedCount =
      currentMonthMessagesCount === USAGE_UNKNOWN
        ? null
        : currentMonthMessagesCount;

    // Built from 0 when the count is unknown, so the bar renders at rest
    // rather than crashing on a null. It is not shown as a real figure:
    // `currentMonthMessagesCount` above is null, and that is the field the
    // page reads before deciding whether to show a number at all.
    const messageLimitInfo = buildMessageLimitInfo(
      resolvedCount ?? 0,
      activePlan.maxMessagesPerMonth,
    );

    return {
      currentMonthMessagesCount: resolvedCount,
      currentMonthCost,
      activePlan,
      maxMonthlyUsageLimit,
      membersCount,
      membersLiteCount,
      messageLimitInfo,
      usageUnit,
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
