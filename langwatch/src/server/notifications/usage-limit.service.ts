import type { PrismaClient, Notification } from "@prisma/client";
import { createLogger } from "../../utils/logger";
import { NOTIFICATION_TYPES } from "./types";
import { NotificationRepository } from "./repositories/notification.repository";
import { MessageCountRepository } from "./repositories/message-count.repository";
import { OrganizationRepository } from "./repositories/organization.repository";
import { ProjectRepository } from "./repositories/project.repository";
import {
  calculateUsagePercentage,
  findCrossedThreshold,
  getSeverityLevel,
  type UsageThreshold,
} from "./helpers/usage-calculations";
import {
  NotificationEmailService,
  type ProjectUsageData,
} from "./services/notification-email.service";

const logger = createLogger("langwatch:notifications:usageLimit");

export interface UsageLimitData {
  organizationId: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
}

/**
 * Service layer for usage limit notification business logic
 * Single Responsibility: Orchestrate usage limit warning workflow
 */
export class UsageLimitService {
  private readonly notificationRepository: NotificationRepository;
  private readonly messageCountRepository: MessageCountRepository;
  private readonly organizationRepository: OrganizationRepository;
  private readonly projectRepository: ProjectRepository;
  private readonly emailService: NotificationEmailService;

  constructor(private readonly prisma: PrismaClient) {
    this.notificationRepository = new NotificationRepository(prisma);
    this.messageCountRepository = new MessageCountRepository();
    this.organizationRepository = new OrganizationRepository(prisma);
    this.projectRepository = new ProjectRepository(prisma);
    this.emailService = new NotificationEmailService();
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
  private async getProjectUsageData(
    organizationId: string,
  ): Promise<ProjectUsageData[]> {
    const projects =
      await this.projectRepository.getProjectsByOrganization(organizationId);

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
   * Create notification record in database
   */
  private async createNotificationRecord({
    organizationId,
    sentAt,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    usagePercentage,
    crossedThreshold,
    recipientsCount,
    successCount,
    failureCount,
    failedRecipients,
  }: {
    organizationId: string;
    sentAt: Date;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    usagePercentage: number;
    crossedThreshold: UsageThreshold;
    recipientsCount: number;
    successCount: number;
    failureCount: number;
    failedRecipients: Array<{ userId: string; email: string; error: string }>;
  }): Promise<Notification> {
    return this.notificationRepository.create({
      organizationId,
      sentAt,
      metadata: {
        type: NOTIFICATION_TYPES.USAGE_LIMIT_WARNING,
        currentUsage: currentMonthMessagesCount,
        limit: maxMonthlyUsageLimit,
        percentage: usagePercentage,
        threshold: crossedThreshold,
        recipientsCount,
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
    if (!crossedThreshold) {
      logger.debug(
        { organizationId, usagePercentage },
        "Usage below all warning thresholds, skipping notification",
      );
      return null;
    }

    // Get organization with admin members
    const orgWithAdmins =
      await this.organizationRepository.getOrganizationWithAdmins(
        organizationId,
      );

    if (!orgWithAdmins) {
      logger.warn({ organizationId }, "Organization not found");
      return null;
    }

    if (orgWithAdmins.admins.length === 0) {
      logger.info(
        {
          organizationId,
          usagePercentage: usagePercentage.toFixed(2),
          threshold: crossedThreshold,
        },
        "No admins with email addresses found, skipping notification",
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
        { organizationId, threshold: crossedThreshold },
        "Notification already sent for this threshold, skipping duplicate",
      );
      return null;
    }

    // Fetch project usage data and send emails
    const projectUsageData = await this.getProjectUsageData(organizationId);
    const severity = getSeverityLevel(crossedThreshold);
    const sentAt = new Date();

    try {
      const { successCount, failureCount, failedRecipients } =
        await this.emailService.sendUsageLimitEmails({
          organizationId,
          organizationName: orgWithAdmins.name,
          adminEmails: orgWithAdmins.admins,
          usagePercentage,
          currentMonthMessagesCount,
          maxMonthlyUsageLimit,
          crossedThreshold,
          projectUsageData,
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
      const notification = await this.createNotificationRecord({
        organizationId,
        sentAt,
        currentMonthMessagesCount,
        maxMonthlyUsageLimit,
        usagePercentage,
        crossedThreshold,
        recipientsCount: orgWithAdmins.admins.length,
        successCount,
        failureCount,
        failedRecipients,
      });

      logger.info(
        {
          organizationId,
          notificationId: notification.id,
          recipientsCount: orgWithAdmins.admins.length,
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
