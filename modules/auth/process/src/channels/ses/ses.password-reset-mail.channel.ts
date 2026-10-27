import { sendResetPasswordEmail, type MailSender } from "@langwatch/mail";

import {
  type PasswordResetLink,
  PasswordResetMailChannel,
} from "../password-reset-mail.channel.ts";

/** Main's password-reset email over the process's mail member; mail off skips it. */
export class SesPasswordResetMailChannel extends PasswordResetMailChannel {
  static create(input: { mailer: MailSender }): SesPasswordResetMailChannel {
    return new SesPasswordResetMailChannel(input.mailer);
  }

  private constructor(private readonly mailer: MailSender) {
    super();
  }

  sendResetLink({ email, resetUrl }: PasswordResetLink): Promise<void> {
    return sendResetPasswordEmail({ email, resetUrl, mailer: this.mailer });
  }
}
