import { sendBudgetIncreaseRequestEmail, type MailSender } from "@langwatch/mail";
import { UserCapabilityUnavailableError } from "@langwatch/user-contract";

import {
  type UserBudgetIncreaseRequestMail,
  UserBudgetRequestMailChannel,
} from "../user-budget-request-mail.channel.ts";

const NO_BASE_URL = "public base URL, so it cannot link the budget increase request";

/**
 * Main's budget-increase mail, through notification's sender. With no public base URL there is
 * no budgets page to link, so every request is refused by name.
 */
export class SesUserBudgetRequestMailChannel extends UserBudgetRequestMailChannel {
  static create(input: {
    mailer: MailSender;
    baseUrl: string | undefined;
  }): SesUserBudgetRequestMailChannel {
    return new SesUserBudgetRequestMailChannel(input.mailer, input.baseUrl);
  }

  private constructor(
    private readonly mailer: MailSender,
    private readonly baseUrl: string | undefined,
  ) {
    super();
  }

  sendBudgetIncreaseRequest(input: UserBudgetIncreaseRequestMail): Promise<void> {
    if (!this.baseUrl) return Promise.reject(new UserCapabilityUnavailableError(NO_BASE_URL));

    return sendBudgetIncreaseRequestEmail({
      mailer: this.mailer,
      ...input,
      budgetsUrl: `${this.baseUrl}/gateway/budgets`,
    });
  }
}
