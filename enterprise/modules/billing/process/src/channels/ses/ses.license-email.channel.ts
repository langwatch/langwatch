import { sendLicenseEmail, type EmailDelivery } from "@langwatch/mail";

import type { LicenseEmailDelivery } from "../../services/license-purchase.service.ts";
import { LicenseEmailChannel } from "../license-email.channel.ts";

/** Main's licence email over the process's mail member. */
export class SesLicenseEmailChannel extends LicenseEmailChannel {
  private constructor(private readonly mailer: EmailDelivery) {
    super();
  }

  static create(mailer: EmailDelivery): SesLicenseEmailChannel {
    return new SesLicenseEmailChannel(mailer);
  }

  send(input: LicenseEmailDelivery): Promise<void> {
    return sendLicenseEmail({ mailer: this.mailer, ...input });
  }
}
