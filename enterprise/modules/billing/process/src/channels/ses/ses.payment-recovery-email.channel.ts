// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { sendPaymentRecoveryEmail, type MailSender } from "@langwatch/mail";

import {
  PaymentRecoveryEmailChannel,
  type PaymentRecoveryEmail,
} from "../payment-recovery-email.channel.ts";

/** The recovery mail over notification's sender. */
export class SesPaymentRecoveryEmailChannel extends PaymentRecoveryEmailChannel {
  static create(mailer: MailSender): SesPaymentRecoveryEmailChannel {
    return new SesPaymentRecoveryEmailChannel(mailer);
  }

  private constructor(private readonly mailer: MailSender) {
    super();
  }

  send({ to, email }: { to: string; email: PaymentRecoveryEmail }): Promise<void> {
    return sendPaymentRecoveryEmail({ mailer: this.mailer, to, ...email });
  }
}
