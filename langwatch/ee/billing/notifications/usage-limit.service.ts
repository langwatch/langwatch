import type { PrismaClient } from "@prisma/client";
import { env } from "../../../src/env.mjs";
import { createLogger } from "../../../src/utils/logger/server";
import { getApp } from "../../../src/server/app-layer/app";
import type { UsageService } from "../../../src/server/app-layer/usage/usage.service";
import { getCurrentMonthStart } from "../../../src/server/utils/dateUtils";
import { captureException } from "../../../src/utils/posthogErrorCapture";
import type {
  NotificationService,
  UsageLimitEmailData,
} from "./notification.service";
import { NotificationRepository } from "./repositories/notification.repository";
import { NOTIFICATION_TYPES } from "./types";
import type { PlanLimitNotifierInput } from "../types";

const logger = createLogger("langwatch:notifications:usageLimit");

const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const; // Thresholds in ascending order
const MIN_DAYS_BETWEEN_ALERTS = 30;

export interface UsageLimitData {
  organizationId: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
}

/**
 * Service layer for usage limit notification business logic.
 * Single Responsibility: Handle business logic for WHEN/WHAT to send.
 *
 * Delegates delivery to {@link NotificationService} (HOW to send).
 * Framework-agnostic - no tRPC dependencies.
 */
export class UsageLimitService {
  private readonly notificationRepository: NotificationRepository;
  private readonly usageService: UsageService;
  private readonly notificationService: NotificationService;

  constructor({
    prisma,
    usageService,
    notificationService,
  }: {
    prisma: PrismaClient;
    usageService?: UsageService;
    notificationService: NotificationService;
  }) {
    this.notificationRepository = new NotificationRepository(prisma);
    this.usageService = usageService ?? getApp().usage;
    this.notificationService = notificationService;
    this.prisma = prisma;
  }

  private readonly prisma: PrismaClient;

  /**
   * Static factory method for creating a UsageLimitService with proper DI.
   */
  static create({
    prisma,
    usageService,
    notificationService,
  }: {
    prisma: PrismaClient;
    usageService?: UsageService;
    notificationService: NotificationService;
  }): UsageLimitService {
    return new UsageLimitService({ prisma, usageService, notificationService });
  }

  /**
   * Notifies internal channels that an organization has reached its plan limit.
   * Absorbed from planLimitNotifier.ts.
   *
   * Checks IS_SAAS env, fetches org with admin members, enforces 30-day cooldown,
   * then delegates to NotificationService for Slack and Hubspot delivery.
   */
  async notifyPlanLimitReached({
    organizationId,
    planName,
  }: PlanLimitNotifierInput): Promise<void> {
    if (!env.IS_SAAS) {
      return;
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        members: {
          where: { role: "ADMIN" },
          include: {
            user: true,
          },
        },
      },
    });

    if (!organization) {
      return;
    }

    if (organization.sentPlanLimitAlert) {
      const timeSinceLastAlert =
        Date.now() - organization.sentPlanLimitAlert.getTime();
      const daysSinceLastAlert = Math.floor(
        timeSinceLastAlert / (1000 * 60 * 60 * 24),
      );

      if (daysSinceLastAlert < MIN_DAYS_BETWEEN_ALERTS) {
        return;
      }
    }

    const admin = organization.members[0]?.user;

    const context = {
      organizationId,
      organizationName: organization.name,
      adminName: admin?.name ?? undefined,
      adminEmail: admin?.email ?? undefined,
      planName,
    };

    await Promise.all([
      this.notificationService.sendSlackPlanLimitAlert(context),
      this.notificationService.sendHubspotPlanLimitForm(context),
    ]);

    try {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: {
          sentPlanLimitAlert: new Date(),
        },
      });
    } catch (error) {
      captureException(
        new Error(
          `Critical: plan limit notification sent but DB timestamp update failed for org ${organizationId} on plan ${planName}`,
          { cause: error },
        ),
      );
    }
  }

  /**
   * Checks if a usage limit warning notification should be sent and sends it if needed.
   * Creates a notification record in the database after successfully sending the email.
   *
   * @param data Usage limit data including organization ID, current usage, and limit
   * @returns The created notification record, or null if no notification was sent
   */
  async checkAndSendWarning(data: UsageLimitData) {
    const { organizationId, currentMonthMessagesCount, maxMonthlyUsageLimit } =
      data;

    const usagePercentage =
      maxMonthlyUsageLimit > 0
        ? (currentMonthMessagesCount / maxMonthlyUsageLimit) * 100
        : 0;

    const crossedThreshold = this.calculateThreshold(usagePercentage);

    if (!crossedThreshold) {
      logger.debug(
        {
          organizationId,
          usagePercentage,
          lowestThreshold: USAGE_WARNING_THRESHOLDS[0],
        },
        "Usage below all warning thresholds, skipping notification",
      );
      return null;
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        members: {
          where: { role: "ADMIN" },
          include: { user: true },
        },
      },
    });

    if (!organization) {
      logger.warn({ organizationId }, "Organization not found");
      return null;
    }

    if (organization.members.length === 0) {
      logger.warn(
        { organizationId },
        "No admin members found for organization",
      );
      return null;
    }

    // Check if we've sent a notification for this specific threshold in the current calendar month.
    //
    // NOTE: This check-then-insert pattern has a small race window where two concurrent
    // workers could both pass the check and send duplicate emails. This is acceptable
    // because: (1) this runs from a single cron worker and a user-initiated tRPC mutation
    // that is unlikely to fire concurrently, and (2) the worst case is a duplicate email
    // in the same month, which is benign. If a stronger guarantee is needed, add a unique
    // constraint on (organizationId, threshold, yearMonth) via a database migration.
    const currentMonthStart = getCurrentMonthStart();

    const recentNotifications =
      await this.notificationRepository.findRecentByOrganization(
        organizationId,
        currentMonthStart,
      );

    const recentNotification = recentNotifications.find((notification) => {
      if (!notification.metadata || typeof notification.metadata !== "object") {
        return false;
      }
      const metadata = notification.metadata as Record<string, unknown>;
      return (
        metadata.type === NOTIFICATION_TYPES.USAGE_LIMIT_WARNING &&
        metadata.threshold === crossedThreshold
      );
    });

    if (recentNotification) {
      logger.debug(
        {
          organizationId,
          threshold: crossedThreshold,
          lastSentAt: recentNotification.sentAt,
          currentMonthStart,
        },
        "Notification already sent for this threshold in current calendar month, skipping duplicate",
      );
      return null;
    }

    // Fetch projects and their usage
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const projectIds = projects.map((p) => p.id);
    const counts = await this.usageService.getCountByProjects({
      organizationId,
      projectIds,
    });
    const countsMap = new Map(counts.map((c) => [c.projectId, c.count]));
    const projectUsageData = projects.map((p) => ({
      id: p.id,
      name: p.name,
      messageCount: countsMap.get(p.id) ?? 0,
    }));

    const emailContext = this.buildEmailContext({
      organizationName: organization.name,
      usagePercentage,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      crossedThreshold,
      projectUsageData,
    });

    const deliverableAdmins = organization.members.filter(
      (member) => member.user.email,
    );

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

    try {
      const { recipientsSuccessCount, recipientsFailureCount, failedRecipients } =
        await this.dispatchEmails({
          organizationId,
          organizationName: organization.name,
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
        throw new Error(
          `All ${recipientsFailureCount} usage limit warning emails failed to send`,
        );
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
      logger.error(
        { error, organizationId },
        "Error sending usage limit warning notifications",
      );
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
    return USAGE_WARNING_THRESHOLDS.findLast(
      (threshold) => usagePercentage >= threshold,
    );
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
    const baseUrl = env.BASE_HOST ?? "https://app.langwatch.ai";
    const actionUrl = `${baseUrl}/settings/usage`;

    // Logo image URL (using PNG for better email client compatibility)
    const logoUrl =
      "https://ci3.googleusercontent.com/meips/ADKq_NaCbt6cv8rmCuTdJyU7KZ6qJLgPHvuxWR2ud8CtuuF97I33b_-E_lMAtaI1Qgi9VlWtWcG1rCjarfQyMZGNr_6Vevm70VjyT-G05bbo7dtXHr8At8jIeAKNhebm0bFH43okoSx3UyqcKkJcahSiOMPDB8YFhbk0Vr-12M2hpmUFcSC6_NgZ9KQQFYXxJaM=s0-d-e1-ft#https://hs-143534269.f.hubspotstarter-eu1.net/hub/143534269/hubfs/header-3.png?width=1116&upscale=true&name=header-3.png";

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
    // Log any admins without emails for visibility
    const adminsWithoutEmail = deliverableAdmins.filter(
      (member) => !member.user.email,
    );
    if (adminsWithoutEmail.length > 0) {
      logger.debug(
        {
          organizationId,
          adminsWithoutEmailCount: adminsWithoutEmail.length,
          adminsWithoutEmailIds: adminsWithoutEmail.map((m) => m.user.id),
        },
        "Some admins lack email addresses and will not receive notifications",
      );
    }

    const emailResults = await Promise.allSettled(
      deliverableAdmins.map(async (member) => {
        await this.notificationService.sendUsageLimitEmail({
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
        logger.warn(
          { index, organizationId },
          "Member not found at index, skipping",
        );
        return;
      }

      if (result.status === "fulfilled") {
        recipientsSuccessCount++;
      } else {
        recipientsFailureCount++;
        const errorMessage =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
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
   * Creates a notification record in the repository after successful email delivery.
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
  }) {
    return this.notificationRepository.create({
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
