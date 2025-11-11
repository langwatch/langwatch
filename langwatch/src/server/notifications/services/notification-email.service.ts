import { sendUsageLimitEmail } from "../../mailer/usageLimitEmail";
import { createLogger } from "../../../utils/logger";
import { EMAIL_CONFIG } from "../../mailer/config/email-constants";
import type {
  SendUsageLimitEmailsParams,
  EmailSendResult,
} from "../types/email-params";

const logger = createLogger("langwatch:notifications:email");

/**
 * Service for sending notification emails
 * Single Responsibility: Send emails to multiple recipients
 */
export class NotificationEmailService {
  /**
   * Send usage limit warning emails to all admin members
   */
  async sendUsageLimitEmails(
    params: SendUsageLimitEmailsParams,
  ): Promise<EmailSendResult> {
    const {
      organizationId,
      organizationName,
      adminEmails,
      usagePercentage,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      crossedThreshold,
      projectUsageData,
      severity,
      actionUrl,
    } = params;

    const usagePercentageFormatted = usagePercentage.toFixed(1);
    const logoUrl = EMAIL_CONFIG.LOGO_URL;

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
}

