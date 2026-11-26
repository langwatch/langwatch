// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { sendBillingFixedEmail, type MailSender } from "@langwatch/mail";

import {
  BillingFixedEmailChannel,
  type BillingFixedEmail,
} from "../billing-fixed-email.channel.ts";

/** The billing-fixed mail over notification's sender. */
export class SesBillingFixedEmailChannel extends BillingFixedEmailChannel {
  static create(mailer: MailSender): SesBillingFixedEmailChannel {
    return new SesBillingFixedEmailChannel(mailer);
  }

  private constructor(private readonly mailer: MailSender) {
    super();
  }

  send({ to, email }: { to: string; email: BillingFixedEmail }): Promise<void> {
    return sendBillingFixedEmail({ mailer: this.mailer, to, ...email });
  }
}
