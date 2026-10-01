import { sendAddressConfirmationEmail, type MailSender } from "@langwatch/mail";

import {
  type AddressConfirmation,
  AddressConfirmationMailChannel,
} from "../address-confirmation-mail.channel.ts";

/** Main's address confirmation over the process's mail member; mail off skips it with one line. */
export class SesAddressConfirmationMailChannel extends AddressConfirmationMailChannel {
  static create(input: { mailer: MailSender; baseUrl: string }): SesAddressConfirmationMailChannel {
    return new SesAddressConfirmationMailChannel(input.mailer, input.baseUrl);
  }

  private constructor(
    private readonly mailer: MailSender,
    private readonly baseUrl: string,
  ) {
    super();
  }

  sendConfirmation({
    email,
    identifierId,
    verificationId,
    token,
  }: AddressConfirmation): Promise<void> {
    const params = new URLSearchParams({
      confirm: identifierId,
      verification: verificationId,
      token,
    });

    return sendAddressConfirmationEmail({
      email,
      verificationUrl: `${this.baseUrl}/settings/security?${params.toString()}`,
      mailer: this.mailer,
    });
  }
}
