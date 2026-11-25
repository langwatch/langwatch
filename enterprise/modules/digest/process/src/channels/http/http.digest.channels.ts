// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";

import type { DigestChannels } from "../digest.channels.ts";
import { SesDigestMailChannel } from "../ses/ses.digest-mail.channel.ts";

/** The weekly email through notification's own sender (§5 binding); no third party. */
export class HttpDigestChannels {
  static readonly requires = [] as const;
  static readonly binds = { notifications: NotificationApi } as const;

  static create({ bound }: { bound: BoundApis<typeof HttpDigestChannels.binds> }): DigestChannels {
    return { mail: SesDigestMailChannel.create({ notifications: bound.notifications }) };
  }
}
