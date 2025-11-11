import type { PrismaClient, Notification } from "@prisma/client";
import { createLogger } from "../../utils/logger";
import { NOTIFICATION_TYPES } from "./types/notification-types-constant";
import { NotificationRepository } from "./repositories/notification.repository";
import { MessageCountRepository } from "../repositories/message-count.repository";
import { OrganizationRepository } from "./repositories/organization.repository";
import { ProjectRepository } from "./repositories/project.repository";
import { calculateUsagePercentage } from "./helpers/usage-calculations/calculate-usage-percentage";
import { findCrossedThreshold } from "./helpers/usage-calculations/find-crossed-threshold";
import { getSeverityLevel } from "./helpers/usage-calculations/get-severity-level";
import type { UsageThreshold } from "./helpers/usage-calculations/usage-threshold.type";
import { NotificationEmailService } from "./services/notification-email.service";
import type { WarningDecisionResult } from "./types/warning-decision/warning-decision-result";
import type { WarningDecisionToSend } from "./types/warning-decision/warning-decision-to-send";
import type { UsageLimitData } from "./types/usage-limit-data";
import type { ProjectUsageData } from "./types/email-params/project-usage-data";
import type { OrganizationWithAdmins } from "./types/organization-repository.types/organization-with-admins";

const logger = createLogger("langwatch:notifications:usageLimit");

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
    this.messageCountRepository = new MessageCountRepository(prisma);
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
        messageCount: await this.messageCountRepository.getProjectCurrentMonthCount({
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
   * Query: Determine if a usage warning should be sent
   * Single Responsibility: Make decision based on current state
   *
   * @param data Usage limit data including organization ID, current usage, and limit
   * @returns Decision object with all necessary data for sending
   */
  async shouldSendWarning(
    data: UsageLimitData,
  ): Promise<WarningDecisionResult> {
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
        "Usage below all warning thresholds",
      );
      return { shouldSend: false, reason: "below_threshold" };
    }

    // Get organization with admin members
    const orgWithAdmins =
      await this.organizationRepository.getOrganizationWithAdmins(
        organizationId,
      );

    if (!orgWithAdmins) {
      logger.warn({ organizationId }, "Organization not found");
      return { shouldSend: false, reason: "organization_not_found" };
    }

    if (orgWithAdmins.admins.length === 0) {
      logger.info(
        {
          organizationId,
          usagePercentage: usagePercentage.toFixed(2),
          threshold: crossedThreshold,
        },
        "No admins with email addresses found",
      );
      return { shouldSend: false, reason: "no_admins" };
    }

    // Check if we've sent a notification for this specific threshold
    const alreadySent = await this.wasNotificationSentForThreshold({
      organizationId,
      threshold: crossedThreshold,
    });

    if (alreadySent) {
      logger.debug(
        { organizationId, threshold: crossedThreshold },
        "Notification already sent for this threshold",
      );
      return { shouldSend: false, reason: "already_sent" };
    }

    // Fetch project usage data for the email
    const projectUsageData = await this.getProjectUsageData(organizationId);
    const severity = getSeverityLevel(crossedThreshold);

    return {
      shouldSend: true,
      organizationId,
      organization: orgWithAdmins,
      usagePercentage,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      crossedThreshold,
      projectUsageData,
      severity,
    };
  }

  /**
   * Command: Send usage warning notification
   * Single Responsibility: Execute the sending action
   *
   * @param decision Decision object from shouldSendWarning
   * @returns The created notification record
   */
  async sendWarning(
    decision: WarningDecisionToSend,
  ): Promise<Notification> {
    const {
      organizationId,
      organization,
      usagePercentage,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      crossedThreshold,
      projectUsageData,
      severity,
    } = decision;

    const sentAt = new Date();

    try {
      const baseUrl = process.env.BASE_HOST ?? "https://app.langwatch.ai";
      const actionUrl = `${baseUrl}/settings/usage`;

      const { successCount, failureCount, failedRecipients } =
        await this.emailService.sendUsageLimitEmails({
          organizationId,
          organizationName: organization.name,
          adminEmails: organization.admins,
          usagePercentage,
          currentMonthMessagesCount,
          maxMonthlyUsageLimit,
          crossedThreshold,
          projectUsageData,
          severity,
          actionUrl,
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
          "All usage limit warning emails failed to send",
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
        recipientsCount: organization.admins.length,
        successCount,
        failureCount,
        failedRecipients,
      });

      logger.info(
        {
          organizationId,
          notificationId: notification.id,
          recipientsCount: organization.admins.length,
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

  /**
   * Fetch usage data and plan limits for an organization
   * Single Responsibility: Data aggregation
   */
  private async fetchUsageLimitData(
    organizationId: string,
  ): Promise<UsageLimitData | null> {
    const currentMonthMessagesCount =
      await this.messageCountRepository.getCurrentMonthCount({ organizationId });

    // No usage - skip
    if (currentMonthMessagesCount === 0) {
      logger.debug({ organizationId }, "No messages, skipping");
      return null;
    }

    // Use dependencies to get subscription info
    const { dependencies } = await import("../../injection/dependencies.server");
    const activePlan =
      await dependencies.subscriptionHandler.getActivePlan(organizationId);

    if (
      !activePlan ||
      typeof activePlan.maxMessagesPerMonth !== "number" ||
      activePlan.maxMessagesPerMonth <= 0
    ) {
      logger.debug({ organizationId }, "Invalid plan configuration, skipping");
      return null;
    }

    return {
      organizationId,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit: activePlan.maxMessagesPerMonth,
    };
  }

  /**
   * Convenience method: Check and send if needed (with explicit data)
   * Used by: Router endpoints that already have usage data
   *
   * @param data Usage limit data
   * @returns The created notification record, or null if not sent
   */
  async checkAndSendWarning(
    data: UsageLimitData | { organizationId: string },
  ): Promise<Notification | null> {
    // Overload: if only organizationId provided, fetch data
    let usageData: UsageLimitData;
    if ("currentMonthMessagesCount" in data) {
      usageData = data;
    } else {
      const fetchedData = await this.fetchUsageLimitData(data.organizationId);
      if (!fetchedData) {
        return null;
      }
      usageData = fetchedData;
    }

    const decision = await this.shouldSendWarning(usageData);

    if (!decision.shouldSend) {
      return null;
    }

    return this.sendWarning(decision);
  }
}
