/**
 * Warning an organization that it is approaching its monthly usage limit.
 */

import { createLogger } from "@langwatch/observability";
import {
  NOTIFICATION_TYPES,
  USAGE_UNKNOWN,
  type BillingUsageCounter,
  type BillingUsageLimitOrganization,
  type UsageLimitData,
} from "@langwatch/enterprise-billing-contract";
import type {
  NotificationService as NotificationRecordService,
  Notification,
} from "@langwatch/notification-contract";
import type { NotificationService, UsageLimitEmailData } from "./billing-usage-notice.service.ts";

const logger = createLogger("langwatch:notifications:usageWarning");

import {
  USAGE_WARNING_THRESHOLDS,
  crossedUsageThreshold,
  getCurrentMonthStart,
  type BillingNextStepResolver,
  type BillingUsageUnit,
  type UsageWarningServiceOptions,
} from "../rules/usage-warning-thresholds.rules.ts";
import { UsageWarningDispatchService } from "./usage-warning-dispatch.service.ts";

export class UsageWarningService {
  private readonly records: NotificationRecordService;
  private readonly organizations: BillingUsageLimitOrganization;
  private readonly usageCounts: BillingUsageCounter;
  private readonly emails: NotificationService;
  private readonly baseHost: string;
  private readonly nextStep: BillingNextStepResolver | undefined;
  private readonly resolveUsageUnit:
    | ((input: { organizationId: string }) => Promise<BillingUsageUnit | undefined>)
    | undefined;

  static create(options: UsageWarningServiceOptions): UsageWarningService {
    return new UsageWarningService(options);
  }

  private constructor(options: UsageWarningServiceOptions) {
    this.records = options.records;
    this.organizations = options.organizations;
    this.usageCounts = options.usageCounts;
    this.emails = options.emails;
    this.baseHost = options.baseHost;
    this.nextStep = options.nextStep;
    this.resolveUsageUnit = options.usageUnit;
    this.dispatch = UsageWarningDispatchService.create({
      records: options.records,
      emails: options.emails,
      baseHost: options.baseHost,
      nextStep: options.nextStep,
      resolveUsageUnit: options.usageUnit,
    });
  }

  private readonly dispatch: UsageWarningDispatchService;

  /**
   * Sends a usage-limit warning email if one is due, and records that it went.
   */
  async tryCheckAndSendWarning(data: UsageLimitData): Promise<Notification | null> {
    const { organizationId, currentMonthMessagesCount, maxMonthlyUsageLimit } = data;

    const usagePercentage =
      maxMonthlyUsageLimit > 0 ? (currentMonthMessagesCount / maxMonthlyUsageLimit) * 100 : 0;
    const crossedThreshold = crossedUsageThreshold(usagePercentage);

    if (!crossedThreshold) {
      logger.debug(
        { organizationId, usagePercentage, lowestThreshold: USAGE_WARNING_THRESHOLDS[0] },
        "Usage below all warning thresholds, skipping notification",
      );

      return null;
    }

    const organization = await this.organizations.findWithAdmins(organizationId);

    if (!organization) {
      logger.warn({ organizationId }, "Organization not found");

      return null;
    }

    if (organization.members.length === 0) {
      logger.warn({ organizationId }, "No admin members found for organization");

      return null;
    }

    if (await this.alreadyWarnedThisMonth({ organizationId, crossedThreshold })) {
      return null;
    }

    const projectUsageData = await this.projectUsage({ organizationId, crossedThreshold });
    if (projectUsageData === null) {
      return null;
    }

    const deliverableAdmins = organization.members.filter((member) => member.user.email);

    if (deliverableAdmins.length === 0) {
      logger.info(
        {
          organizationId,
          totalAdmins: organization.members.length,
          usagePercentage: usagePercentage.toFixed(2),
          threshold: crossedThreshold,
        },
        "No admins with email addresses found, skipping notification (no deliverable recipients)",
      );

      return null;
    }

    return this.sendAndRecord({
      organizationId,
      organizationName: organization.name,
      deliverableAdmins,
      emailContext: await this.dispatch.buildEmailContext({
        organizationId,
        organizationName: organization.name,
        pricingModel: organization.pricingModel,
        currency: organization.currency,
        usagePercentage,
        currentMonthMessagesCount,
        maxMonthlyUsageLimit,
        crossedThreshold,
        projectUsageData,
      }),
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      usagePercentage,
      crossedThreshold,
    });
  }

  /**
   * Whether this threshold was already warned about in the current calendar month.
   */
  private async alreadyWarnedThisMonth({
    organizationId,
    crossedThreshold,
  }: {
    organizationId: string;
    crossedThreshold: number;
  }): Promise<boolean> {
    const currentMonthStart = getCurrentMonthStart();

    const recentNotifications = await this.records.listRecentByOrganization({
      organizationId,
      since: currentMonthStart,
    });

    const alreadySent = recentNotifications.find((notification) => {
      if (!notification.metadata || typeof notification.metadata !== "object") {
        return false;
      }

      const metadata = notification.metadata as Record<string, unknown>;

      return (
        metadata.type === NOTIFICATION_TYPES.USAGE_LIMIT_WARNING &&
        metadata.threshold === crossedThreshold
      );
    });

    if (!alreadySent) {
      return false;
    }

    logger.debug(
      {
        organizationId,
        threshold: crossedThreshold,
        lastSentAt: alreadySent.sentAt,
        currentMonthStart,
      },
      "Notification already sent for this threshold in current calendar month, skipping duplicate",
    );

    return true;
  }

  /**
   * Per-project message counts, or null when they cannot be read.
   */
  private async projectUsage({
    organizationId,
    crossedThreshold,
  }: {
    organizationId: string;
    crossedThreshold: number;
  }): Promise<Array<{ id: string; name: string; messageCount: number }> | null> {
    const projects = await this.organizations.findProjectsWithName(organizationId);
    const counts = await this.usageCounts.getCountByProjects({
      organizationId,
      projectIds: projects.map((project) => project.id),
    });

    if (counts === USAGE_UNKNOWN) {
      logger.warn(
        { organizationId, crossedThreshold },
        "usage is unknown, skipping usage-limit email rather than reporting zeros",
      );

      return null;
    }

    const countsMap = new Map(counts.map((count) => [count.projectId, count.count]));

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      messageCount: countsMap.get(project.id) ?? 0,
    }));
  }

  /**
   * Sends to every deliverable admin and records that it happened.
   */
  private async sendAndRecord({
    organizationId,
    organizationName,
    deliverableAdmins,
    emailContext,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    usagePercentage,
    crossedThreshold,
  }: {
    organizationId: string;
    organizationName: string;
    deliverableAdmins: Array<{ user: { id: string; name: string | null; email: string | null } }>;
    emailContext: UsageLimitEmailData;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    usagePercentage: number;
    crossedThreshold: number;
  }): Promise<Notification> {
    try {
      const { recipientsSuccessCount, recipientsFailureCount, failedRecipients } =
        await this.dispatch.dispatchEmails({
          organizationId,
          organizationName,
          deliverableAdmins,
          emailContext,
        });

      if (recipientsSuccessCount === 0) {
        logger.error(
          {
            organizationId,
            recipientsFailureCount,
            failedRecipients,
            usagePercentage: usagePercentage.toFixed(2),
            threshold: crossedThreshold,
          },
          "All usage limit warning emails failed to send, aborting notification creation to allow retries",
        );

        throw new Error(`All ${recipientsFailureCount} usage limit warning emails failed to send`);
      }

      const notification = await this.dispatch.recordNotification({
        organizationId,
        currentMonthMessagesCount,
        maxMonthlyUsageLimit,
        usagePercentage,
        crossedThreshold,
        deliverableAdminsCount: deliverableAdmins.length,
        recipientsSuccessCount,
        recipientsFailureCount,
        failedRecipients,
      });

      logger.info(
        {
          organizationId,
          notificationId: notification.id,
          recipientsCount: deliverableAdmins.length,
          recipientsSuccessCount,
          recipientsFailureCount,
          ...(recipientsFailureCount > 0 && { failedRecipients }),
          usagePercentage: usagePercentage.toFixed(2),
          threshold: crossedThreshold,
        },
        "Usage limit warning notifications sent successfully",
      );

      return notification;
    } catch (error) {
      logger.error({ error, organizationId }, "Error sending usage limit warning notifications");

      throw error;
    }
  }

  // -------------------------------------------------------------------------
}
