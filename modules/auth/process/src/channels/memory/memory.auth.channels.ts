import type { MailSender } from "@langwatch/mail";
import { NotificationService } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";

import type { AuthChannels } from "../auth.channels.ts";
import { SesPasswordResetMailChannel } from "../ses/ses.password-reset-mail.channel.ts";
import { SesSignUpVerificationMailChannel } from "../ses/ses.sign-up-verification-mail.channel.ts";
import { MemoryCliDeviceSettlementChannel } from "./memory.cli-device-settlement.channel.ts";
import { MemorySignupAnnouncementChannel } from "./memory.signup-announcement.channel.ts";

/** In-process settlements and announcements; mail goes to notification, a peer on this tier too. */
export class MemoryAuthChannels {
  static readonly requires = [] as const;
  static readonly binds = { notifications: NotificationService } as const;

  static create({ bound }: { bound: BoundApis<typeof MemoryAuthChannels.binds> }): AuthChannels {
    const mailer: MailSender = { send: (content) => bound.notifications.sendEmail(content) };
    return {
      cliSettlements: MemoryCliDeviceSettlementChannel.create(),
      signupAnnouncements: MemorySignupAnnouncementChannel.create(),
      passwordResetMail: SesPasswordResetMailChannel.create({ mailer }),
      signUpVerificationMail: SesSignUpVerificationMailChannel.create({ mailer }),
    };
  }
}
