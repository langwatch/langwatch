import type {
  PlanInfo,
  SendUsageLimitWarningInput,
  UsageLimitWarning,
} from "@langwatch/entitlement-contract";
import type { Logger } from "@langwatch/observability";

import { USAGE_UNKNOWN, type UsageCount } from "../app/entitlement.members.ts";

type UsageWarningSweepDeps = Readonly<{
  isSaas: boolean;
  logger: Pick<Logger, "debug" | "info" | "warn" | "error">;
  organizationIds: () => Promise<string[]>;
  projectIds: (organizationId: string) => Promise<string[]>;
  currentMonthCount: (organizationId: string) => Promise<UsageCount | "unlimited">;
  activePlan: (organizationId: string) => Promise<Pick<PlanInfo, "maxMessagesPerMonth">>;
  send: (input: SendUsageLimitWarningInput) => Promise<UsageLimitWarning>;
}>;

/** Main's `/cron/trace_analytics` (routes/cron.ts:79-192): every organization's usage warning. */
export class UsageWarningSweepService {
  static create(deps: UsageWarningSweepDeps): UsageWarningSweepService {
    return new UsageWarningSweepService(deps);
  }

  private constructor(private readonly deps: UsageWarningSweepDeps) {}

  async sweep(): Promise<void> {
    if (!this.deps.isSaas) {
      this.deps.logger.debug("skipping usage limit notifications (not SaaS)");
      return;
    }
    for (const organizationId of await this.deps.organizationIds()) {
      try {
        await this.checkOrganization(organizationId);
      } catch (error) {
        this.deps.logger.error(
          { organizationId, error },
          "error checking usage limits for organization",
        );
      }
    }
  }

  private async checkOrganization(organizationId: string): Promise<void> {
    const { logger } = this.deps;
    const projectIds = await this.deps.projectIds(organizationId);
    if (projectIds.length === 0) {
      logger.debug({ organizationId }, "organization has no projects, skipping");
      return;
    }
    const currentMonthCount = await this.deps.currentMonthCount(organizationId);
    if (currentMonthCount === "unlimited") {
      logger.debug({ organizationId }, "organization has unlimited plan, skipping usage check");
      return;
    }
    if (currentMonthCount === USAGE_UNKNOWN) {
      logger.warn(
        { organizationId },
        "usage is unknown, skipping usage check for this organization",
      );
      return;
    }
    const { maxMessagesPerMonth } = await this.deps.activePlan(organizationId);
    if (typeof maxMessagesPerMonth !== "number" || maxMessagesPerMonth <= 0) {
      logger.debug(
        { organizationId },
        "organization has invalid or missing plan configuration, skipping",
      );
      return;
    }
    if (currentMonthCount > 1) {
      logger.info(
        {
          organizationId,
          currentMonthMessagesCount: currentMonthCount,
          maxMessagesPerMonth,
          usagePercentage: Number(((currentMonthCount / maxMessagesPerMonth) * 100).toFixed(1)),
          projectCount: projectIds.length,
        },
        "organization usage stats",
      );
    }
    await this.deps.send({
      organizationId,
      currentMonthMessagesCount: currentMonthCount,
      maxMonthlyUsageLimit: maxMessagesPerMonth,
    });
  }
}
