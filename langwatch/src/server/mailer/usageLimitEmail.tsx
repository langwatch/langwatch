import { render } from "@react-email/render";
import { sendEmail } from "./emailSender";
import { UsageLimitEmailTemplate } from "./components/UsageLimitEmailTemplate";
import type { SendUsageLimitEmailParams } from "./types/usage-limit-email/send-params";

/**
 * Send usage limit warning email
 * Single Responsibility: Orchestrate email rendering and sending
 */
export async function sendUsageLimitEmail({
  to,
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
}: SendUsageLimitEmailParams): Promise<void> {
  const subject = `Usage Limit ${severity} - ${usagePercentageFormatted}% of limit reached`;

  const emailHtml = await render(
    UsageLimitEmailTemplate({
      organizationName,
      usagePercentage,
      usagePercentageFormatted,
      currentMonthMessagesCount,
      maxMonthlyUsageLimit,
      crossedThreshold,
      projectUsageData,
      actionUrl,
      logoUrl,
    }),
  );

  await sendEmail({
    to,
    subject,
    html: emailHtml,
  });
}
