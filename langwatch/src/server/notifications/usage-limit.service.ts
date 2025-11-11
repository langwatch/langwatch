import type { PrismaClient, Notification } from "@prisma/client";
import { sendUsageLimitEmail } from "../mailer/usageLimitEmail";
import { createLogger } from "../../utils/logger";
import { env } from "../../env.mjs";
import { NOTIFICATION_TYPES } from "./types";
import { NotificationRepository } from "./repositories/notification.repository";
import { MessageCountRepository } from "./repositories/message-count.repository";
import {
  calculateUsagePercentage,
  findCrossedThreshold,
  getSeverityLevel,
  type UsageThreshold,
} from "./helpers/usage-calculations";

const logger = createLogger("langwatch:notifications:usageLimit");

export interface UsageLimitData {
  organizationId: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
}

interface ProjectUsageData {
  id: string;
  name: string;
  messageCount: number;
}

/**
 * Service layer for usage limit notification business logic
 * Single Responsibility: Orchestrate usage limit warning workflow
 */
export class UsageLimitService {
  private readonly notificationRepository: NotificationRepository;
  private readonly messageCountRepository: MessageCountRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.notificationRepository = new NotificationRepository(prisma);
    this.messageCountRepository = new MessageCountRepository();
  }

  /**
   * Static factory method for creating a UsageLimitService with proper DI
   */
  static create(prisma: PrismaClient): UsageLimitService {
    return new UsageLimitService(prisma);
  }

  /**
   * Get the start of the current calendar month
   */
  private getCurrentMonth(): Date {
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  }

  /**
   * Check if notification was already sent for this threshold in current month
   */
  private async wasNotificationSentForThreshold({
    organizationId,
    threshold,
  }: {
    organizationId: string;
    threshold: UsageThreshold;
  }): Promise<boolean> {
    const currentMonthStart = this.getCurrentMonth();
    const recentNotifications =
      await this.notificationRepository.findRecentByOrganization(
        organizationId,
        currentMonthStart,
      );

    return recentNotifications.some((notification) => {
      if (!notification.metadata || typeof notification.metadata !== "object") {
        return false;
      }
      const metadata = notification.metadata as Record<string, unknown>;
      return (
        metadata.type === NOTIFICATION_TYPES.USAGE_LIMIT_WARNING &&
        metadata.threshold === threshold
      );
    });
  }

  /**
   * Fetch projects and their usage data
   */
  private async getProjectUsageData({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ProjectUsageData[]> {
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

    return Promise.all(
      projects.map(async (project) => ({
        id: project.id,
        name: project.name,
        messageCount: await this.messageCountRepository.getProjectMessageCount({
          projectId: project.id,
          organizationId,
        }),
      })),
    );
  }

  /**
   * Send emails to all admin members
   */
  private async sendEmailsToAdmins({
    organizationId,
    organizationName,
    adminEmails,
    usagePercentage,
    usagePercentageFormatted,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    crossedThreshold,
    projectUsageData,
    actionUrl,
    logoUrl,
    severity,
  }: {
    organizationId: string;
    organizationName: string;
    adminEmails: Array<{ userId: string; email: string }>;
    usagePercentage: number;
    usagePercentageFormatted: string;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    crossedThreshold: UsageThreshold;
    projectUsageData: ProjectUsageData[];
    actionUrl: string;
    logoUrl: string;
    severity: string;
  }): Promise<{
    successCount: number;
    failureCount: number;
    failedRecipients: Array<{ userId: string; email: string; error: string }>;
  }> {
    const emailResults = await Promise.allSettled(
      adminEmails.map(async ({ email }) => {
        await sendUsageLimitEmail({
          to: email,
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
        });
      }),
    );

    let successCount = 0;
    let failureCount = 0;
    const failedRecipients: Array<{
      userId: string;
      email: string;
      error: string;
    }> = [];

    emailResults.forEach((result, index) => {
      const admin = adminEmails[index];
      if (!admin) {
        logger.warn(
          { index, organizationId },
          "Admin not found at index, skipping",
        );
        return;
      }

      if (result.status === "fulfilled") {
        successCount++;
      } else {
        failureCount++;
        const errorMessage =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        failedRecipients.push({
          userId: admin.userId,
          email: admin.email,
          error: errorMessage,
        });
        logger.error(
          {
            userId: admin.userId,
            email: admin.email,
            error: result.reason,
            organizationId,
          },
          "Failed to send usage limit warning email",
        );
      }
    });

    return { successCount, failureCount, failedRecipients };
  }

  /**
   * Checks if a usage limit warning notification should be sent and sends it if needed
   * Creates a notification record in the database after successfully sending the email
   *
   * @param data Usage limit data including organization ID, current usage, and limit
   * @returns The created notification record, or null if no notification was sent
   */
  async checkAndSendWarning(
    data: UsageLimitData,
  ): Promise<Notification | null> {
    const { organizationId, currentMonthMessagesCount, maxMonthlyUsageLimit } =
      data;

    // Calculate usage percentage
    const usagePercentage = calculateUsagePercentage({
      currentUsage: currentMonthMessagesCount,
      limit: maxMonthlyUsageLimit,
    });

    // Find the highest threshold that has been crossed
    const crossedThreshold = findCrossedThreshold(usagePercentage);

    // If no threshold has been crossed, don't send notification
    if (!crossedThreshold) {
      logger.debug(
        {
          organizationId,
          usagePercentage,
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

    // Check if we've sent a notification for this specific threshold
    const alreadySent = await this.wasNotificationSentForThreshold({
      organizationId,
      threshold: crossedThreshold,
    });

    if (alreadySent) {
      logger.debug(
        {
          organizationId,
          threshold: crossedThreshold,
        },
        "Notification already sent for this threshold, skipping duplicate",
      );
      return null;
    }

    // Filter to only admins with email addresses
    const deliverableAdmins = organization.members
      .filter((member) => member.user.email)
      .map((member) => ({
        userId: member.user.id,
        email: member.user.email!,
      }));

    if (deliverableAdmins.length === 0) {
      logger.info(
        {
          organizationId,
          totalAdmins: organization.members.length,
          usagePercentage: usagePercentage.toFixed(2),
          threshold: crossedThreshold,
        },
        "No admins with email addresses found, skipping notification",
      );
      return null;
    }

    // Fetch project usage data
    const projectUsageData = await this.getProjectUsageData({ organizationId });

    // Prepare email data
    const sentAt = new Date();
    const baseUrl = env.BASE_HOST ?? "https://app.langwatch.ai";
    const actionUrl = `${baseUrl}/settings/usage`;
    const logoUrl =
      "https://ci3.googleusercontent.com/meips/ADKq_NaCbt6cv8rmCuTdJyU7KZ6qJLgPHvuxWR2ud8CtuuF97I33b_-E_lMAtaI1Qgi9VlWtWcG1rCjarfQyMZGNr_6Vevm70VjyT-G05bbo7dtXHr8At8jIeAKNhebm0bFH43okoSx3UyqcKkJcahSiOMPDB8YFhbk0Vr-12M2hpmUFcSC6_NgZ9KQQFYXxJaM=s0-d-e1-ft#https://hs-143534269.f.hubspotstarter-eu1.net/hub/143534269/hubfs/header-3.png?width=1116&upscale=true&name=header-3.png";
    const usagePercentageFormatted = usagePercentage.toFixed(1);
    const severity = getSeverityLevel(crossedThreshold);

    try {
      // Send emails to all deliverable admins
      const { successCount, failureCount, failedRecipients } =
        await this.sendEmailsToAdmins({
          organizationId,
          organizationName: organization.name,
          adminEmails: deliverableAdmins,
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

      // Only create notification if at least one email succeeded
      if (successCount === 0) {
        logger.error(
          {
            organizationId,
            failureCount,
            failedRecipients,
            usagePercentage: usagePercentage.toFixed(2),
            threshold: crossedThreshold,
          },
          "All usage limit warning emails failed to send, aborting notification creation",
        );
        throw new Error(
          `All ${failureCount} usage limit warning emails failed to send`,
        );
      }

      // Create notification record
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
          recipientsSuccessCount: successCount,
          recipientsFailureCount: failureCount,
          ...(failureCount > 0 && {
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
          successCount,
          failureCount,
          ...(failureCount > 0 && { failedRecipients }),
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
