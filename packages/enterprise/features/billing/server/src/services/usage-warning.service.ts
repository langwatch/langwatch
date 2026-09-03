/**
 * Warning an organization that it is approaching its monthly usage limit.
 *
 * Separate from `UsageLimitService`, which answers a different question: that
 * one reports a limit the customer has ALREADY hit, and reports it to our own
 * internal channels. This one emails the customer's own admins on the way up,
 * at 50, 70, 90, 95 and 100 percent of their allowance.
 *
 * Only the highest threshold crossed is warned about, and only once per
 * calendar month, so a customer who goes from 45 to 96 percent in one
 * afternoon gets a single email about 95 rather than three about 50, 70 and
 * 90.
 *
 * The email is the point of the whole path, so nothing is recorded until at
 * least one has been delivered: a notification row written after a total
 * delivery failure would suppress the retry that could still reach somebody.
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
import type { NotificationService, UsageLimitEmailData } from "./notification.service";

const logger = createLogger("langwatch:notifications:usageWarning");

/** Ascending, so the last one passed is the highest one crossed. */
const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const;

const getCurrentMonthStart = (): Date => {
  const now = new Date();

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

export type UsageWarningServiceOptions = {
  records: NotificationRecordService;
  organizations: BillingUsageLimitOrganization;
  usageCounts: BillingUsageCounter;
  emails: NotificationService;
  baseHost: string;
};

export class UsageWarningService {
  private readonly records: NotificationRecordService;
  private readonly organizations: BillingUsageLimitOrganization;
  private readonly usageCounts: BillingUsageCounter;
  private readonly emails: NotificationService;
  private readonly baseHost: string;

  constructor(options: UsageWarningServiceOptions) {
    this.records = options.records;
    this.organizations = options.organizations;
    this.usageCounts = options.usageCounts;
    this.emails = options.emails;
    this.baseHost = options.baseHost;
  }

  /**
   * Sends a usage-limit warning email if one is due, and records that it went.
   *
   * Returns the notification record, or null when nothing was sent — which is
   * the common case: below every threshold, already warned this month, no
   * organization, no admin with an email.
   */
  async checkAndSendWarning(data: UsageLimitData): Promise<Notification | null> {
    const { organizationId, currentMonthMessagesCount, maxMonthlyUsageLimit } = data;

    const usagePercentage =
      maxMonthlyUsageLimit > 0 ? (currentMonthMessagesCount / maxMonthlyUsageLimit) * 100 : 0;
    const crossedThreshold = this.calculateThreshold(usagePercentage);

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
      emailContext: this.buildEmailContext({
        organizationName: organization.name,
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
   * Whether this threshold was already warned about in the current calendar
   * month.
   *
   * Check-then-insert, so two workers could in principle both pass and send a
   * duplicate. Accepted: this runs from one cron worker and a user-initiated
   * mutation that are unlikely to fire together, and a repeated email in the
   * same month is benign. A unique constraint on
   * (organizationId, threshold, yearMonth) is the fix if that stops being true.
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
   *
   * The breakdown is the substance of this email. Sending it with every project
   * reading 0 — which is what an unknown count used to become — tells an admin
   * their usage collapsed, in a message whose entire premise is that their
   * usage is high. Better to send nothing: the threshold is still crossed on
   * the next run, when the numbers are real.
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
   *
   * Throws when not one email got through, so the caller's retry can have
   * another go — recording a notification nobody received would suppress the
   * warning for the rest of the month.
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
        await this.dispatchEmails({
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

      const notification = await this.recordNotification({
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
  // Private helpers for checkAndSendWarning
  // -------------------------------------------------------------------------

  /**
   * Finds the highest warning threshold crossed by the current usage percentage.
   */
  private calculateThreshold(
    usagePercentage: number,
  ): (typeof USAGE_WARNING_THRESHOLDS)[number] | undefined {
    let crossed: (typeof USAGE_WARNING_THRESHOLDS)[number] | undefined;
    for (const threshold of USAGE_WARNING_THRESHOLDS) {
      if (usagePercentage >= threshold) crossed = threshold;
    }
    return crossed;
  }

  /**
   * Builds the email data object with severity, formatting, and presentation constants.
   */
  private buildEmailContext({
    organizationName,
    usagePercentage,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    crossedThreshold,
    projectUsageData,
  }: {
    organizationName: string;
    usagePercentage: number;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    crossedThreshold: number;
    projectUsageData: Array<{ id: string; name: string; messageCount: number }>;
  }): UsageLimitEmailData {
    const actionUrl = `${this.baseHost}/settings/usage`;

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
    };
  }

  /**
   * Sends usage limit emails to all deliverable admins, tracking successes and failures.
   */
  private async dispatchEmails({
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
        await this.emails.sendUsageLimitEmail({
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
  private async recordNotification({
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
    return this.records.create({
      organizationId,
      sentAt: new Date(),
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
