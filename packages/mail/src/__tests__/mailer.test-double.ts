import type { EmailContent, MailSender } from "../email-sender.ts";

export class TestMailer implements MailSender {
  async send(_content: EmailContent): Promise<unknown> {
    return undefined;
  }
}
