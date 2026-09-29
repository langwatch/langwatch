import { sendSignUpVerificationEmail, type MailSender } from "@langwatch/mail";

import {
  type SignUpVerificationLink,
  SignUpVerificationMailChannel,
} from "../sign-up-verification-mail.channel.ts";

/** Main's sign-up verification email over the process's mail member; mail off skips it. */
export class SesSignUpVerificationMailChannel extends SignUpVerificationMailChannel {
  static create(input: { mailer: MailSender }): SesSignUpVerificationMailChannel {
    return new SesSignUpVerificationMailChannel(input.mailer);
  }

  private constructor(private readonly mailer: MailSender) {
    super();
  }

  sendVerificationLink({ email, verificationUrl }: SignUpVerificationLink): Promise<void> {
    return sendSignUpVerificationEmail({ email, verificationUrl, mailer: this.mailer });
  }
}
