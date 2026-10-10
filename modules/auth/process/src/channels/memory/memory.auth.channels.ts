import type { SlackNoticeMessage } from "@langwatch/internal-slack";
import type { MailSender } from "@langwatch/mail";
import { NotificationService } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";

import type { AuthChannels } from "../auth.channels.ts";
import { SesPasswordResetMailChannel } from "../ses/ses.password-reset-mail.channel.ts";
import { SesSignUpVerificationMailChannel } from "../ses/ses.sign-up-verification-mail.channel.ts";
import { SignupAnnouncementChannel } from "../signup-announcement.channel.ts";
import { MemoryAuth0PasswordChannel } from "./memory.auth0-password.channel.ts";
import { MemoryCliDeviceSettlementChannel } from "./memory.cli-device-settlement.channel.ts";

/** In-process settlements and announcements, an unconfigured Auth0 tenant; mail to notification. */
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
      auth0Passwords: MemoryAuth0PasswordChannel.create({ outcome: "not_configured" }),
    };
  }
}

/** Records what would have been posted to the sign-ups channel, without a network call. */
export class MemorySignupAnnouncementChannel extends SignupAnnouncementChannel {
  readonly posted: SlackNoticeMessage[] = [];

  private constructor() {
    super();
  }

  static create(): MemorySignupAnnouncementChannel {
    return new MemorySignupAnnouncementChannel();
  }

  async post(message: SlackNoticeMessage): Promise<void> {
    this.posted.push(message);
  }
}
