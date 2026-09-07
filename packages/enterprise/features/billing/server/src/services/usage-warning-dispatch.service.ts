/**
 * The usage-limit warning as it reaches a person: the copy the mail is built from, the send to
 * every deliverable admin, and the record written once at least one send succeeded. A hook that
 * cannot be resolved truthfully is left out rather than guessed — the message still goes out.
 */
import { createLogger } from "@langwatch/observability";
import {
  NOTIFICATION_TYPES,
  type BillingPricingModel,
} from "@langwatch/enterprise-billing-contract";
import type {
  NotificationService as NotificationRecordService,
  Notification,
} from "@langwatch/notification-contract";
import type { NotificationService, UsageLimitEmailData } from "./billing-usage-notice.service.ts";
import type {
  BillingNextStepResolver,
  BillingUsageUnit,
} from "../rules/usage-warning-thresholds.rules.ts";
import { nowInstant, toDate } from "@langwatch/time";

const logger = createLogger("langwatch:notifications:usageWarning");

type UsageWarningDispatchOptions = {
  records: NotificationRecordService;
  emails: NotificationService;
  baseHost: string;
  nextStep: BillingNextStepResolver | undefined;
  resolveUsageUnit:
    | ((input: { organizationId: string }) => Promise<BillingUsageUnit | undefined>)
    | undefined;
};

export class UsageWarningDispatchService {
  static create(deps: UsageWarningDispatchOptions): UsageWarningDispatchService {
    return new UsageWarningDispatchService(deps);
  }

  private constructor(private readonly deps: UsageWarningDispatchOptions) {}

  /**
   * Builds the email data object with severity, formatting, and presentation constants.
   */
  async buildEmailContext({
    organizationId,
    organizationName,
    pricingModel,
    currency,
    usagePercentage,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    crossedThreshold,
    projectUsageData,
  }: {
    organizationId: string;
    organizationName: string;
    pricingModel: BillingPricingModel | null;
    currency: "USD" | "EUR";
    usagePercentage: number;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    crossedThreshold: number;
    projectUsageData: Array<{ id: string; name: string; messageCount: number }>;
  }): Promise<UsageLimitEmailData> {
    const actionUrl = `${this.deps.baseHost}/settings/usage`;

    const [usageUnit, nextStep] = await Promise.all([
      this.tryResolveUsageUnit({ organizationId }),
      this.tryResolveNextStep({ organizationId, pricingModel, currency }),
    ]);

    const logoUrl =
      "https://hs-143534269.f.hubspotstarter-eu1.net/hub/143534269/hubfs/header-3.png?width=1116&upscale=true&name=header-3.png";

    const cappedPercentage = Math.min(usagePercentage, 100);
    const usagePercentageFormatted = Math.floor(cappedPercentage).toString();

    let severity: string;
    if (crossedThreshold >= 95) {
      severity = "Critical";
    } else if (crossedThreshold >= 90) {
      severity = "High";
    } else if (crossedThreshold >= 70) {
      severity = "Medium";
    } else {
      severity = "Info";
    }

    return {
      organizationName,
      usagePercentage,
      usagePercentageFormatted,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      crossedThreshold,
      projectUsageData,
      actionUrl,
      logoUrl,
      severity,
      ...(usageUnit !== undefined && { usageUnit }),
      ...(nextStep !== undefined && { nextStep }),
    };
  }

  /** What this organization is metered in, or nothing when the deployment composed no meter. */
  private async tryResolveUsageUnit(input: {
    organizationId: string;
  }): Promise<BillingUsageUnit | undefined> {
    if (!this.deps.resolveUsageUnit) return undefined;
    try {
      return await this.deps.resolveUsageUnit(input);
    } catch (error) {
      logger.warn(
        { organizationId: input.organizationId, error },
        "Could not resolve the usage unit for a usage-limit email; the mail keeps its default word",
      );

      return undefined;
    }
  }

  /**
   * Where this organization can go next, or nothing when the deployment composed no
   * catalogue, or the plan could not be read. A hook that cannot be resolved truthfully
   * is omitted rather than guessed — the service message it rides on still goes out.
   */
  private async tryResolveNextStep(input: {
    organizationId: string;
    pricingModel: BillingPricingModel | null;
    currency: "USD" | "EUR";
  }): Promise<UsageLimitEmailData["nextStep"] | undefined> {
    if (!this.deps.nextStep) return undefined;
    try {
      return await this.deps.nextStep.resolve(input);
    } catch (error) {
      logger.warn(
        { organizationId: input.organizationId, error },
        "Could not resolve the next-step plan for a usage-limit email; the mail omits it",
      );

      return undefined;
    }
  }

  /**
   * Sends usage limit emails to all deliverable admins, tracking successes and failures.
   */
  async dispatchEmails({
    organizationId,
    organizationName,
    deliverableAdmins,
    emailContext,
  }: {
    organizationId: string;
    organizationName: string;
    deliverableAdmins: Array<{ user: { id: string; email: string | null } }>;
    emailContext: UsageLimitEmailData;
  }) {
    const emailResults = await Promise.allSettled(
      deliverableAdmins.map(async (member) => {
        await this.deps.emails.sendUsageLimitEmail({
          to: member.user.email!,
          orgName: organizationName,
          usageData: emailContext,
        });
      }),
    );

    let recipientsSuccessCount = 0;
    let recipientsFailureCount = 0;
    const failedRecipients: Array<{ userId: string; error: string }> = [];

    emailResults.forEach((result, index) => {
      const member = deliverableAdmins[index];
      if (!member) {
        logger.warn({ index, organizationId }, "Member not found at index, skipping");

        return;
      }

      if (result.status === "fulfilled") {
        recipientsSuccessCount++;
      } else {
        recipientsFailureCount++;
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        failedRecipients.push({
          userId: member.user.id,
          error: errorMessage,
        });
        logger.error(
          {
            userId: member.user.id,
            error: errorMessage,
            organizationId,
          },
          "Failed to send usage limit warning email",
        );
      }
    });

    return { recipientsSuccessCount, recipientsFailureCount, failedRecipients };
  }

  /**
   * Creates a notification record through the canonical Notification service
   * after successful email delivery.
   */
  async recordNotification({
    organizationId,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    usagePercentage,
    crossedThreshold,
    deliverableAdminsCount,
    recipientsSuccessCount,
    recipientsFailureCount,
    failedRecipients,
  }: {
    organizationId: string;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    usagePercentage: number;
    crossedThreshold: number;
    deliverableAdminsCount: number;
    recipientsSuccessCount: number;
    recipientsFailureCount: number;
    failedRecipients: Array<{ userId: string; error: string }>;
  }): Promise<Notification> {
    return this.deps.records.create({
      organizationId,
      sentAt: toDate(nowInstant()),
      metadata: {
        type: NOTIFICATION_TYPES.USAGE_LIMIT_WARNING,
        currentUsage: currentMonthMessagesCount,
        limit: maxMonthlyUsageLimit,
        percentage: usagePercentage,
        threshold: crossedThreshold,
        recipientsCount: deliverableAdminsCount,
        recipientsSuccessCount,
        recipientsFailureCount,
        ...(recipientsFailureCount > 0 && {
          failedRecipients: failedRecipients.map((f) => ({
            userId: f.userId,
            error: f.error,
          })),
        }),
      },
    });
  }
}
