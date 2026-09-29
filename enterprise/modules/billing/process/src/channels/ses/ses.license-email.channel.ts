import { sendLicenseEmail, type MailSender } from "@langwatch/mail";

import type { LicenseEmailDelivery } from "../../services/license-purchase.service.ts";
import { LicenseEmailChannel } from "../license-email.channel.ts";

/** Main's licence email over notification's sender. */
export class SesLicenseEmailChannel extends LicenseEmailChannel {
  private constructor(private readonly mailer: MailSender) {
    super();
  }

  static create(mailer: MailSender): SesLicenseEmailChannel {
    return new SesLicenseEmailChannel(mailer);
  }

  send(input: LicenseEmailDelivery): Promise<void> {
    return sendLicenseEmail({ mailer: this.mailer, ...input });
  }
}
