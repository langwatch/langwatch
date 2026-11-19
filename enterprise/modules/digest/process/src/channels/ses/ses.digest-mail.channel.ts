// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { mailTemplates, renderMailTemplate } from "@langwatch/mail";
import type { NotificationService } from "@langwatch/notification-contract";

import { type DigestMail, DigestMailChannel } from "../digest-mail.channel.ts";

/**
 * Renders the picked `@langwatch/mail` digest template and sends it through
 * `NotificationApi.sendEmail`, which writes the RFC 8058 one-click header pair.
 */
export class SesDigestMailChannel extends DigestMailChannel {
  static create(deps: {
    notifications: Pick<NotificationService, "sendEmail">;
  }): SesDigestMailChannel {
    return new SesDigestMailChannel(deps.notifications);
  }

  private constructor(private readonly notifications: Pick<NotificationService, "sendEmail">) {
    super();
  }

  async send(mail: DigestMail): Promise<void> {
    const template = mailTemplates.find((candidate) => candidate.id === mail.templateId);
    if (!template) throw new Error(`@langwatch/mail holds no ${mail.templateId} template`);
    // The rendered plain-text part is left behind: `SendEmailCommand` is strict and takes none.
    const { subject, html } = await renderMailTemplate(template, mail.props);
    await this.notifications.sendEmail({
      to: mail.to,
      subject: mail.test ? `[Test] ${subject}` : subject,
      html,
      unsubscribe: { url: mail.oneClickUnsubscribeUrl },
      ...(mail.idempotencyKey === undefined ? {} : { idempotencyKey: mail.idempotencyKey }),
    });
  }
}
