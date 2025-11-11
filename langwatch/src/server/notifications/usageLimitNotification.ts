import { prisma } from "../db";
import { sendUsageLimitEmail } from "../mailer/usageLimitEmail";
import { createLogger } from "../../utils/logger";
import { NotificationType } from "@prisma/client";
import { env } from "../../env.mjs";
import { esClient, TRACE_INDEX } from "../elasticsearch";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";

const logger = createLogger("langwatch:notifications:usageLimit");

const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const; // Thresholds in ascending order

/**
 * Get the start of the current calendar month
 */
const getCurrentMonth = () => {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
};

/**
 * Get message count for a single project in the current month
 */
async function getProjectMessageCount(
  projectId: string,
  organizationId: string,
): Promise<number> {
  try {
    const client = await esClient({ organizationId });
    const currentMonthStart = getCurrentMonth().getTime();

    const result = await client.count({
      index: TRACE_INDEX.alias,
      body: {
        query: {
          bool: {
            must: [
              {
                term: {
                  project_id: projectId,
                },
              },
              {
                range: {
                  "timestamps.inserted_at": {
                    gte: currentMonthStart,
                  },
                },
              },
            ] as QueryDslBoolQuery["filter"],
          } as QueryDslBoolQuery,
        },
      },
    });

    return result.count;
  } catch (error) {
    logger.error(
      { error, projectId, organizationId },
      "Error getting project message count",
    );
    return 0;
  }
}

interface UsageLimitData {
  organizationId: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
}

/**
 * Checks if a usage limit warning notification should be sent and sends it if needed.
 * Creates a notification record in the database after successfully sending the email.
 *
 * @param data Usage limit data including organization ID, current usage, and limit
 * @returns The created notification record, or null if no notification was sent
 */
export async function checkAndSendUsageLimitWarning(data: UsageLimitData) {
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
    console.log("Usage below all warning thresholds, skipping notification");
    return null;
  }

  // Get organization with admin members
  const organization = await prisma.organization.findUnique({
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
    logger.warn({ organizationId }, "No admin members found for organization");
    return null;
  }

  // Check if we've sent a notification for this specific threshold in the current calendar month
  const currentMonthStart = getCurrentMonth();

  const recentNotifications = await prisma.notification.findMany({
    where: {
      organizationId,
      type: NotificationType.USAGE_LIMIT_WARNING,
      sentAt: {
        gte: currentMonthStart,
      },
    },
  });

  // Check if any notification has the same threshold in metadata
  const recentNotification = recentNotifications.find((notification) => {
    if (!notification.metadata || typeof notification.metadata !== "object") {
      return false;
    }
    const metadata = notification.metadata as Record<string, unknown>;
    return metadata.threshold === crossedThreshold;
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
    console.log(
      "Notification already sent for this threshold in current calendar month, skipping duplicate",
    );
    return null;
  }

  // Fetch projects and their usage
  const projects = await prisma.project.findMany({
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

  // Get message counts per project
  const projectUsageData = await Promise.all(
    projects.map(async (project) => ({
      id: project.id,
      name: project.name,
      messageCount: await getProjectMessageCount(project.id, organizationId),
    })),
  );

  // Send email to all admin members
  const sentAt = new Date();
  const baseUrl = env.BASE_HOST ?? "https://app.langwatch.ai";
  const actionUrl = `${baseUrl}/settings/usage`;

  // Logo image URL (using PNG for better email client compatibility)
  const logoUrl =
    "https://ci3.googleusercontent.com/meips/ADKq_NaCbt6cv8rmCuTdJyU7KZ6qJLgPHvuxWR2ud8CtuuF97I33b_-E_lMAtaI1Qgi9VlWtWcG1rCjarfQyMZGNr_6Vevm70VjyT-G05bbo7dtXHr8At8jIeAKNhebm0bFH43okoSx3UyqcKkJcahSiOMPDB8YFhbk0Vr-12M2hpmUFcSC6_NgZ9KQQFYXxJaM=s0-d-e1-ft#https://hs-143534269.f.hubspotstarter-eu1.net/hub/143534269/hubfs/header-3.png?width=1116&upscale=true&name=header-3.png";

  const usagePercentageFormatted = usagePercentage.toFixed(1);

  // Determine severity based on threshold
  let severity = "Warning";
  if (crossedThreshold >= 100) {
    severity = "Critical";
  } else if (crossedThreshold >= 95) {
    severity = "Critical";
  } else if (crossedThreshold >= 90) {
    severity = "High";
  } else if (crossedThreshold >= 70) {
    severity = "Medium";
  } else {
    severity = "Info";
  }

  try {
    // Send emails to all admins
    const emailResults = await Promise.allSettled(
      organization.members.map(async (member) => {
        if (!member.user.email) {
          logger.warn(
            { userId: member.user.id },
            "Admin user has no email, skipping",
          );
          return;
        }

        await sendUsageLimitEmail({
          to: member.user.email,
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
      const member = organization.members[index];
      if (!member) {
        logger.warn(
          { index, organizationId },
          "Member not found at index, skipping",
        );
        return;
      }
      if (!member.user.email) {
        // Already logged as warning above, skip counting
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
    const notification = await prisma.notification.create({
      data: {
        type: NotificationType.USAGE_LIMIT_WARNING,
        organizationId,
        sentAt,
        metadata: {
          currentUsage: currentMonthMessagesCount,
          limit: maxMonthlyUsageLimit,
          percentage: usagePercentage,
          threshold: crossedThreshold,
          recipientsCount: organization.members.filter(
            (member) => member.user.email,
          ).length,
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
      },
    });

    logger.info(
      {
        organizationId,
        notificationId: notification.id,
        recipientsCount: organization.members.filter(
          (member) => member.user.email,
        ).length,
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
