import { sendUsageLimitEmail, type MailSender } from "@langwatch/mail";

import type { UsageLimitEmailData } from "../../services/billing-usage-notice.service.ts";
import { UsageLimitEmailChannel } from "../usage-limit-email.channel.ts";

/** The approaching-limit mail over notification's sender, rendered from main's copy. */
export class SesUsageLimitEmailChannel extends UsageLimitEmailChannel {
  static create(mailer: MailSender): SesUsageLimitEmailChannel {
    return new SesUsageLimitEmailChannel(mailer);
  }

  private constructor(private readonly mailer: MailSender) {
    super();
  }

  send({ to, usage }: { to: string; usage: UsageLimitEmailData }): Promise<void> {
    return sendUsageLimitEmail({
      mailer: this.mailer,
      to,
      organizationName: usage.organizationName,
      usagePercentage: usage.usagePercentage,
      usagePercentageFormatted: usage.usagePercentageFormatted,
      currentMonthMessagesCount: usage.currentMonthMessagesCount,
      maxMonthlyUsageLimit: usage.maxMonthlyUsageLimit,
      crossedThreshold: usage.crossedThreshold,
      projectUsageData: usage.projectUsageData,
      actionUrl: usage.actionUrl,
      severity: usage.severity,
    });
  }
}
