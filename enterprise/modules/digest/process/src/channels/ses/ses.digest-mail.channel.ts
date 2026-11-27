// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NotificationService } from "@langwatch/notification-contract";

import { DigestMailChannel, type RenderedDigestMail } from "../digest-mail.channel.ts";

/**
 * Sends a rendered digest email through `NotificationApi.sendEmail`, which writes the RFC 8058
 * one-click header pair.
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

  send(mail: RenderedDigestMail): Promise<void> {
    return this.notifications.sendEmail(mail.email);
  }
}
