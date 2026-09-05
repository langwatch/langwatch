/**
 * One organization's usage against what its plan allows. Seven readings, issued together: the
 * month's real volume, the month's spend, the active plan, the allowance, the two member counts
 * and the unit the allowance is measured in.
 */
import type {
  MessageLimitInfo,
  MessageLimitStatus,
  PlanProvider,
  PlanProviderUser,
  UsageStats,
} from "@langwatch/entitlement-contract";
import { USAGE_UNKNOWN, UsageCounterPort } from "../ports/usage-counter.port";
import type { UsageMembershipPort } from "../ports/usage-membership.port";

/**
 * The message allowance a plan states when it means "we do not cap this". Stated rather than
 * imported from the Enterprise billing contract, which a core package may not reach into.
 */
const UNLIMITED_MESSAGES = 999_999_999;

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const wholePercent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

/** `1,234`, the way every usage surface writes a count. */
function formatNumber(value: number): string {
  return wholeNumber.format(value);
}

/** `80%`, the way every usage surface writes a fraction of an allowance. */
function formatPercent(value: number): string {
  return wholePercent.format(value);
}

/** Threshold at which to show a warning (80% of limit) */
export const MESSAGE_LIMIT_WARNING_THRESHOLD = 0.8;

/** The operator a plan is resolved for. */
export type UsageStatsCaller = PlanProviderUser;

/**
 * Service for retrieving organization usage statistics.
 */
export class UsageStatsService {
  static create(options: {
    membership: UsageMembershipPort;
    counter: UsageCounterPort;
    plans: PlanProvider;
  }): UsageStatsService {
    return new UsageStatsService(options.membership, options.counter, options.plans);
  }

  private constructor(
    private readonly membership: UsageMembershipPort,
    private readonly counter: UsageCounterPort,
    private readonly planProvider: PlanProvider,
  ) {}

  /**
   * Calculates the message limit status based on current usage and max allowed.
   */
  static getMessageLimitStatus(current: number, max: number): MessageLimitStatus {
    if (max === 0 || max === Number.MAX_SAFE_INTEGER || max >= UNLIMITED_MESSAGES) {
      return "ok";
    }

    if (current >= max) {
      return "exceeded";
    }

    if (current >= max * MESSAGE_LIMIT_WARNING_THRESHOLD) {
      return "warning";
    }

    return "ok";
  }

  /**
   * Builds the complete message limit info with pre-formatted values.
   */
  static buildMessageLimitInfo(current: number, max: number): MessageLimitInfo {
    const status = UsageStatsService.getMessageLimitStatus(current, max);
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
   * Gets comprehensive usage statistics for an organization.
   * Aggregates data from multiple sources in parallel.
   */
  async getUsageStats(organizationId: string, user: UsageStatsCaller): Promise<UsageStats> {
    const [
      currentMonthMessagesCount,
      currentMonthCost,
      activePlan,
      maxMonthlyUsageLimit,
      membersCount,
      membersLiteCount,
      usageUnit,
    ] = await Promise.all([
      this.counter.getCurrentMonthCountForDisplay({ organizationId }),
      this.membership.getCurrentMonthCost(organizationId),
      this.planProvider.getActivePlan({ organizationId, user }),
      this.getMaxMonthlyUsageLimit(organizationId),
      this.membership.getMemberCount(organizationId),
      this.membership.getMembersLiteCount(organizationId),
      this.counter.getResolvedUsageUnit({ organizationId }),
    ]);

    // Real metered/trace volume for the month — surfaced even for unlimited (seat-based) plans
    // so the usage page shows actual billable events. `null` when the counting store could not
    // answer. That is what the `number | null` on UsageStats was always for, and it is the
    // difference between a page saying "we can't show this right now" and one asserting that a
    // busy organization sent nothing this month.
    const resolvedCount =
      currentMonthMessagesCount === USAGE_UNKNOWN ? null : currentMonthMessagesCount;

    // Built from 0 when the count is unknown, so the bar renders at rest
    // rather than crashing on a null. It is not shown as a real figure:
    // `currentMonthMessagesCount` above is null, and that is the field the
    // page reads before deciding whether to show a number at all.
    const messageLimitInfo = UsageStatsService.buildMessageLimitInfo(
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
   * Get the maximum monthly usage limit for the organization. FIXME: This was recently changed
   * to return Infinity, but still takes the organizationId as a parameter.
   */
  private async getMaxMonthlyUsageLimit(_organizationId: string): Promise<number> {
    return Infinity;
  }
}
