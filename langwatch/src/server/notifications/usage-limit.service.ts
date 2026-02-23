import type { PrismaClient } from "@prisma/client";
import { env } from "../../env.mjs";
import { createLogger } from "../../utils/logger/server";
import { sendUsageLimitEmail } from "../mailer/usageLimitEmail";
import { getApp } from "../app-layer/app";
import type { UsageService } from "../app-layer/usage/usage.service";
import { getCurrentMonthStart } from "../utils/dateUtils";
import { NotificationRepository } from "./repositories/notification.repository";
import { NOTIFICATION_TYPES } from "./types";

const logger = createLogger("langwatch:notifications:usageLimit");

const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const; // Thresholds in ascending order

export interface UsageLimitData {
  organizationId: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
}

/**
 * Service layer for usage limit notification business logic
 * Single Responsibility: Handle business logic for usage limit warnings
 *
 * Framework-agnostic - no tRPC dependencies.
 */
export class UsageLimitService {
  private readonly notificationRepository: NotificationRepository;
  private readonly usageService: UsageService;

  constructor(
    private readonly prisma: PrismaClient,
    usageService?: UsageService,
  ) {
    this.notificationRepository = new NotificationRepository(prisma);
    this.usageService = usageService ?? getApp().usage;
  }

  /**
   * Static factory method for creating a UsageLimitService with proper DI.
   */
  static create(prisma: PrismaClient): UsageLimitService {
    return new UsageLimitService(prisma);
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

    // Calculate usage percentage
    const usagePercentage =
      maxMonthlyUsageLimit > 0
        ? (currentMonthMessagesCount / maxMonthlyUsageLimit) * 100
        : 0;

    // Find the highest threshold that has been crossed
    const crossedThreshold = USAGE_WARNING_THRESHOLDS.findLast(
      (threshold) => usagePercentage >= threshold,
    );

    // If no threshold has been crossed, don't send notification
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

    // Get organization with admin members
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

    // Check if we've sent a notification for this specific threshold in the current calendar month
    const currentMonthStart = getCurrentMonthStart();

    const recentNotifications =
      await this.notificationRepository.findRecentByOrganization(
        organizationId,
        currentMonthStart,
      );

    // Filter for USAGE_LIMIT_WARNING notifications and check if any have the same threshold
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
      where: {
        team: { organizationId },
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    // Get message counts per project via UsageService
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

    // Send email to all admin members
    const sentAt = new Date();
    const baseUrl = env.BASE_HOST ?? "https://app.langwatch.ai";
    const actionUrl = `${baseUrl}/settings/usage`;

    // Logo image URL (using PNG for better email client compatibility)
    const logoUrl =
      "https://ci3.googleusercontent.com/meips/ADKq_NaCbt6cv8rmCuTdJyU7KZ6qJLgPHvuxWR2ud8CtuuF97I33b_-E_lMAtaI1Qgi9VlWtWcG1rCjarfQyMZGNr_6Vevm70VjyT-G05bbo7dtXHr8At8jIeAKNhebm0bFH43okoSx3UyqcKkJcahSiOMPDB8YFhbk0Vr-12M2hpmUFcSC6_NgZ9KQQFYXxJaM=s0-d-e1-ft#https://hs-143534269.f.hubspotstarter-eu1.net/hub/143534269/hubfs/header-3.png?width=1116&upscale=true&name=header-3.png";

    // Cap at 100% maximum, then round down to whole number (no decimal)
    const cappedPercentage = Math.min(usagePercentage, 100);
    const usagePercentageFormatted = Math.floor(cappedPercentage).toString();

    // Determine severity based on threshold
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

    try {
      // Filter to only admins with email addresses (deliverable recipients)
      const deliverableAdmins = organization.members.filter(
        (member) => member.user.email,
      );

      // Short-circuit if there are no deliverable recipients
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

      // Log any admins without emails for visibility
      const adminsWithoutEmail = organization.members.filter(
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

      // Send emails to all deliverable admins
      const emailResults = await Promise.allSettled(
        deliverableAdmins.map(async (member) => {
          await sendUsageLimitEmail({
            to: member.user.email!,
            organizationName: organization.name,
            usagePercentage,
            usagePercentageFormatted,
            currentMonthMessagesCount,
            maxMonthlyUsageLimit,
            crossedThreshold,
            projectUsageData,
            actionUrl,
            logoUrl,
            severity,
          });
        }),
      );

      // Process results: count successes and failures
      let recipientsSuccessCount = 0;
      let recipientsFailureCount = 0;
      const failedRecipients: Array<{
        userId: string;
        email: string | null;
        error: string;
      }> = [];

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
            email: member.user.email,
            error: errorMessage,
          });
          logger.error(
            {
              userId: member.user.id,
              email: member.user.email,
              error: result.reason,
              organizationId,
            },
            "Failed to send usage limit warning email",
          );
        }
      });

      // Only create notification if at least one email succeeded
      // This error should only occur if there were deliverable recipients but all sends failed
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

      // Create a single notification record for the organization
      const notification = await this.notificationRepository.create({
        organizationId,
        sentAt,
        metadata: {
          type: NOTIFICATION_TYPES.USAGE_LIMIT_WARNING,
          currentUsage: currentMonthMessagesCount,
          limit: maxMonthlyUsageLimit,
          percentage: usagePercentage,
          threshold: crossedThreshold,
          recipientsCount: deliverableAdmins.length,
          recipientsSuccessCount,
          recipientsFailureCount,
          ...(recipientsFailureCount > 0 && {
            failedRecipients: failedRecipients.map((f) => ({
              userId: f.userId,
              email: f.email,
              error: f.error,
            })),
          }),
        },
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
}
