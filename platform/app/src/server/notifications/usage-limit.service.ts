import { createLogger } from "@langwatch/observability";
import type { Notification, PrismaClient } from "@prisma/client";
import { env } from "../../env.mjs";
import { getApp } from "../app-layer/app";
import type { UsageService } from "../app-layer/usage/usage.service";
import { sendUsageLimitEmail } from "../mailer/usageLimitEmail";
import { USAGE_UNKNOWN } from "../traces/usage-count";
import { getCurrentMonthStart } from "../utils/dateUtils";
import { NotificationRepository } from "./repositories/notification.repository";
import { NOTIFICATION_TYPES } from "./types";

const logger = createLogger("langwatch:notifications:usageLimit");

const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const; // Thresholds in ascending order

// Logo image URL (using PNG for better email client compatibility)
const USAGE_LIMIT_EMAIL_LOGO_URL =
  "https://ci3.googleusercontent.com/meips/ADKq_NaCbt6cv8rmCuTdJyU7KZ6qJLgPHvuxWR2ud8CtuuF97I33b_-E_lMAtaI1Qgi9VlWtWcG1rCjarfQyMZGNr_6Vevm70VjyT-G05bbo7dtXHr8At8jIeAKNhebm0bFH43okoSx3UyqcKkJcahSiOMPDB8YFhbk0Vr-12M2hpmUFcSC6_NgZ9KQQFYXxJaM=s0-d-e1-ft#https://hs-143534269.f.hubspotstarter-eu1.net/hub/143534269/hubfs/header-3.png?width=1116&upscale=true&name=header-3.png";

export interface UsageLimitData {
  organizationId: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
}

// Structural subset of the Prisma organization-member-with-user shape;
// deliberately loose so any richer query result is assignable.
interface AdminMember {
  user: {
    id: string;
    email: string | null;
  };
}

interface ProjectUsageEntry {
  id: string;
  name: string;
  messageCount: number;
}

interface FailedRecipient {
  userId: string;
  email: string | null;
  error: string;
}

interface EmailDeliverySummary {
  recipientsSuccessCount: number;
  recipientsFailureCount: number;
  failedRecipients: FailedRecipient[];
}

interface UsageWarningEmailContext {
  sentAt: Date;
  actionUrl: string;
  logoUrl: string;
  usagePercentageFormatted: string;
  severity: string;
}

// Structural subset of the Prisma organization shape used once admin
// members have already been fetched and validated as non-empty.
interface OrganizationWithAdmins {
  name: string;
  members: AdminMember[];
}

interface WarningDeliveryParams {
  organization: OrganizationWithAdmins;
  organizationId: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  usagePercentage: number;
  crossedThreshold: number;
  projectUsageData: ProjectUsageEntry[];
  emailContext: UsageWarningEmailContext;
}

const computeUsagePercentage = ({
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
}: {
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
}): number =>
  maxMonthlyUsageLimit > 0
    ? (currentMonthMessagesCount / maxMonthlyUsageLimit) * 100
    : 0;

// Find the highest threshold that has been crossed
const findCrossedThreshold = (usagePercentage: number) =>
  USAGE_WARNING_THRESHOLDS.findLast(
    (threshold) => usagePercentage >= threshold,
  );

const notificationMatchesThreshold = (
  notification: Notification,
  crossedThreshold: number,
): boolean => {
  if (!notification.metadata || typeof notification.metadata !== "object") {
    return false;
  }
  const metadata = notification.metadata as Record<string, unknown>;
  return (
    metadata.type === NOTIFICATION_TYPES.USAGE_LIMIT_WARNING &&
    metadata.threshold === crossedThreshold
  );
};

// Determine severity based on threshold
const determineSeverity = (crossedThreshold: number): string => {
  if (crossedThreshold >= 95) return "Critical";
  if (crossedThreshold >= 90) return "High";
  if (crossedThreshold >= 70) return "Medium";
  return "Info";
};

const buildEmailContext = (
  usagePercentage: number,
  crossedThreshold: number,
): UsageWarningEmailContext => {
  const baseUrl = env.BASE_HOST ?? "https://app.langwatch.ai";
  // Cap at 100% maximum, then round down to whole number (no decimal)
  const cappedPercentage = Math.min(usagePercentage, 100);
  return {
    sentAt: new Date(),
    actionUrl: `${baseUrl}/settings/usage`,
    logoUrl: USAGE_LIMIT_EMAIL_LOGO_URL,
    usagePercentageFormatted: Math.floor(cappedPercentage).toString(),
    severity: determineSeverity(crossedThreshold),
  };
};

const selectDeliverableAdmins = <T extends AdminMember>(
  members: T[],
): { deliverable: T[]; withoutEmail: T[] } => ({
  deliverable: members.filter((member) => member.user.email),
  withoutEmail: members.filter((member) => !member.user.email),
});

const sendEmailsToAdmins = async ({
  deliverableAdmins,
  organizationName,
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
  usagePercentage,
  crossedThreshold,
  projectUsageData,
  emailContext,
}: {
  deliverableAdmins: AdminMember[];
  organizationName: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  usagePercentage: number;
  crossedThreshold: number;
  projectUsageData: ProjectUsageEntry[];
  emailContext: UsageWarningEmailContext;
}) =>
  Promise.allSettled(
    deliverableAdmins.map(async (member) => {
      await sendUsageLimitEmail({
        to: member.user.email!,
        organizationName,
        usagePercentage,
        usagePercentageFormatted: emailContext.usagePercentageFormatted,
        currentMonthMessagesCount,
        maxMonthlyUsageLimit,
        crossedThreshold,
        projectUsageData,
        actionUrl: emailContext.actionUrl,
        logoUrl: emailContext.logoUrl,
        severity: emailContext.severity,
      });
    }),
  );

const summarizeEmailResults = ({
  emailResults,
  deliverableAdmins,
  organizationId,
}: {
  emailResults: PromiseSettledResult<void>[];
  deliverableAdmins: AdminMember[];
  organizationId: string;
}): EmailDeliverySummary => {
  const summary: EmailDeliverySummary = {
    recipientsSuccessCount: 0,
    recipientsFailureCount: 0,
    failedRecipients: [],
  };

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
      summary.recipientsSuccessCount++;
    } else {
      summary.recipientsFailureCount++;
      const errorMessage =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      summary.failedRecipients.push({
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

  return summary;
};

const buildNotificationMetadata = ({
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
  usagePercentage,
  crossedThreshold,
  deliverableAdmins,
  summary,
}: {
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  usagePercentage: number;
  crossedThreshold: number;
  deliverableAdmins: AdminMember[];
  summary: EmailDeliverySummary;
}) => ({
  type: NOTIFICATION_TYPES.USAGE_LIMIT_WARNING,
  currentUsage: currentMonthMessagesCount,
  limit: maxMonthlyUsageLimit,
  percentage: usagePercentage,
  threshold: crossedThreshold,
  recipientsCount: deliverableAdmins.length,
  recipientsSuccessCount: summary.recipientsSuccessCount,
  recipientsFailureCount: summary.recipientsFailureCount,
  ...(summary.recipientsFailureCount > 0 && {
    failedRecipients: summary.failedRecipients.map((f) => ({
      userId: f.userId,
      email: f.email,
      error: f.error,
    })),
  }),
});

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

    const usagePercentage = computeUsagePercentage({
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
    });
    const crossedThreshold = findCrossedThreshold(usagePercentage);

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

    const organization = await this.fetchOrganizationWithAdmins(organizationId);
    if (!organization) return null;

    const alreadyNotified = await this.wasThresholdAlreadyNotified({
      organizationId,
      crossedThreshold,
    });
    if (alreadyNotified) return null;

    const projectUsageData = await this.buildProjectUsageData(organizationId);
    // See the ee notifier: an email whose point is "your usage is high" must
    // not go out with every project showing 0 because the counting store was
    // unreachable. Skip rather than misinform.
    if (projectUsageData === USAGE_UNKNOWN) return;

    const emailContext = buildEmailContext(usagePercentage, crossedThreshold);

    return this.deliverUsageWarningEmails({
      organization,
      organizationId,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      usagePercentage,
      crossedThreshold,
      projectUsageData,
      emailContext,
    });
  }

  /**
   * Fetches the organization together with its ADMIN-role members, logging
   * and returning null when there is nowhere to deliver a warning.
   */
  private async fetchOrganizationWithAdmins(organizationId: string) {
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

    return organization;
  }

  /**
   * Checks if we've already sent a notification for this specific threshold
   * in the current calendar month.
   */
  private async wasThresholdAlreadyNotified({
    organizationId,
    crossedThreshold,
  }: {
    organizationId: string;
    crossedThreshold: number;
  }): Promise<boolean> {
    const currentMonthStart = getCurrentMonthStart();

    const recentNotifications =
      await this.notificationRepository.findRecentByOrganization(
        organizationId,
        currentMonthStart,
      );

    const recentNotification = recentNotifications.find((notification) =>
      notificationMatchesThreshold(notification, crossedThreshold),
    );

    if (!recentNotification) return false;

    logger.debug(
      {
        organizationId,
        threshold: crossedThreshold,
        lastSentAt: recentNotification.sentAt,
        currentMonthStart,
      },
      "Notification already sent for this threshold in current calendar month, skipping duplicate",
    );
    return true;
  }

  /**
   * Fetches projects and their message counts via UsageService, shaped for
   * the warning email. Returns USAGE_UNKNOWN when the counting store could
   * not be reached.
   */
  private async buildProjectUsageData(
    organizationId: string,
  ): Promise<ProjectUsageEntry[] | typeof USAGE_UNKNOWN> {
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

    const projectIds = projects.map((p) => p.id);
    const counts = await this.usageService.getCountByProjects({
      organizationId,
      projectIds,
    });
    if (counts === USAGE_UNKNOWN) {
      logger.warn(
        { organizationId },
        "usage is unknown, skipping usage-limit email rather than reporting zeros",
      );
      return USAGE_UNKNOWN;
    }

    const countsMap = new Map(counts.map((c) => [c.projectId, c.count]));
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      messageCount: countsMap.get(p.id) ?? 0,
    }));
  }

  /**
   * Sends the warning email to every deliverable admin and, once at least
   * one send succeeds, persists a single notification record.
   */
  private async deliverUsageWarningEmails(params: WarningDeliveryParams) {
    const { organizationId } = params;
    try {
      const delivery = await this.sendWarningEmailsToAdmins(params);
      if (!delivery) return null;

      return await this.finalizeWarningNotification({ ...params, ...delivery });
    } catch (error) {
      logger.error(
        { error, organizationId },
        "Error sending usage limit warning notifications",
      );
      throw error;
    }
  }

  /**
   * Filters admins to deliverable recipients, sends the warning email to
   * each, and summarizes the send results. Returns null when there are no
   * deliverable recipients at all.
   */
  private async sendWarningEmailsToAdmins({
    organization,
    organizationId,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    usagePercentage,
    crossedThreshold,
    projectUsageData,
    emailContext,
  }: WarningDeliveryParams): Promise<{
    deliverableAdmins: AdminMember[];
    summary: EmailDeliverySummary;
  } | null> {
    const { deliverable: deliverableAdmins, withoutEmail: adminsWithoutEmail } =
      selectDeliverableAdmins(organization.members);

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

    const emailResults = await sendEmailsToAdmins({
      deliverableAdmins,
      organizationName: organization.name,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      usagePercentage,
      crossedThreshold,
      projectUsageData,
      emailContext,
    });

    const summary = summarizeEmailResults({
      emailResults,
      deliverableAdmins,
      organizationId,
    });

    return { deliverableAdmins, summary };
  }

  /**
   * Rejects the delivery when every send failed, otherwise persists the
   * notification record and logs the outcome.
   */
  private async finalizeWarningNotification({
    organizationId,
    currentMonthMessagesCount,
    maxMonthlyUsageLimit,
    usagePercentage,
    crossedThreshold,
    emailContext,
    deliverableAdmins,
    summary,
  }: WarningDeliveryParams & {
    deliverableAdmins: AdminMember[];
    summary: EmailDeliverySummary;
  }) {
    // Only create notification if at least one email succeeded
    // This error should only occur if there were deliverable recipients but all sends failed
    if (summary.recipientsSuccessCount === 0) {
      logger.error(
        {
          organizationId,
          recipientsFailureCount: summary.recipientsFailureCount,
          failedRecipients: summary.failedRecipients,
          usagePercentage: usagePercentage.toFixed(2),
          threshold: crossedThreshold,
        },
        "All usage limit warning emails failed to send, aborting notification creation to allow retries",
      );
      throw new Error(
        `All ${summary.recipientsFailureCount} usage limit warning emails failed to send`,
      );
    }

    // Create a single notification record for the organization
    const notification = await this.notificationRepository.create({
      organizationId,
      sentAt: emailContext.sentAt,
      metadata: buildNotificationMetadata({
        currentMonthMessagesCount,
        maxMonthlyUsageLimit,
        usagePercentage,
        crossedThreshold,
        deliverableAdmins,
        summary,
      }),
    });

    logger.info(
      {
        organizationId,
        notificationId: notification.id,
        recipientsCount: deliverableAdmins.length,
        recipientsSuccessCount: summary.recipientsSuccessCount,
        recipientsFailureCount: summary.recipientsFailureCount,
        ...(summary.recipientsFailureCount > 0 && {
          failedRecipients: summary.failedRecipients,
        }),
        usagePercentage: usagePercentage.toFixed(2),
        threshold: crossedThreshold,
      },
      "Usage limit warning notifications sent successfully",
    );

    return notification;
  }
}
