import { NOTIFICATION_TYPES } from "@langwatch/enterprise-billing-contract";
import type {
  NotificationService as NotificationRecordService,
  Notification,
} from "@langwatch/notification-contract";
/**
 * The usage-limit warning as it reaches a person: the copy the mail is built from, the send to
 * every deliverable admin, and the record written once at least one send succeeded.
 */
import { createLogger } from "@langwatch/observability";
import { nowInstant, toDate } from "@langwatch/time";

import type { NotificationService, UsageLimitEmailData } from "./billing-usage-notice.service.ts";

const logger = createLogger("langwatch:notifications:usageWarning");

type UsageWarningDispatchOptions = {
  records: Pick<NotificationRecordService, "create">;
  emails: Pick<NotificationService, "sendUsageLimitEmail">;
  baseHost: string;
};

/** Main's header image, carried on the email data as main's service carried it. */
const LOGO_URL =
  "https://hs-143534269.f.hubspotstarter-eu1.net/hub/143534269/hubfs/header-3.png?width=1116&upscale=true&name=header-3.png";

export class UsageWarningDispatchService {
  static create(deps: UsageWarningDispatchOptions): UsageWarningDispatchService {
    return new UsageWarningDispatchService(deps);
  }

  private constructor(private readonly deps: UsageWarningDispatchOptions) {}

  /**
   * Builds the email data object with severity, formatting, and presentation constants.
   */
  buildEmailContext({
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
    projectUsageData: { id: string; name: string; messageCount: number }[];
  }): UsageLimitEmailData {
    const cappedPercentage = Math.min(usagePercentage, 100);

    return {
      organizationName,
      usagePercentage,
      usagePercentageFormatted: Math.floor(cappedPercentage).toString(),
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      crossedThreshold,
      projectUsageData,
      actionUrl: `${this.deps.baseHost}/settings/usage`,
      logoUrl: LOGO_URL,
      severity: severityOf(crossedThreshold),
    };
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
    deliverableAdmins: { user: { id: string; email: string | null } }[];
    emailContext: UsageLimitEmailData;
  }): Promise<{
    recipientsSuccessCount: number;
    recipientsFailureCount: number;
    failedRecipients: { userId: string; error: string }[];
  }> {
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
    const failedRecipients: { userId: string; error: string }[] = [];

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
    failedRecipients: { userId: string; error: string }[];
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

function severityOf(crossedThreshold: number): string {
  if (crossedThreshold >= 95) return "Critical";
  if (crossedThreshold >= 90) return "High";
  if (crossedThreshold >= 70) return "Medium";
  return "Info";
}
