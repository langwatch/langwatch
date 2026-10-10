import type { SlackNoticeMessage } from "@langwatch/internal-slack";
import type { MailSender } from "@langwatch/mail";
import { NotificationService } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";

import type { AuthChannels } from "../auth.channels.ts";
import {
  Auth0PasswordChannel,
  type Auth0PasswordChangeOutcome,
  type Auth0PasswordChangeRequest,
} from "../auth0-password.channel.ts";
import { SesPasswordResetMailChannel } from "../ses/ses.password-reset-mail.channel.ts";
import { SesSignUpVerificationMailChannel } from "../ses/ses.sign-up-verification-mail.channel.ts";
import { SignupAnnouncementChannel } from "../signup-announcement.channel.ts";
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

/** Answers every change with the outcome it was built with, and records each request. */
export class MemoryAuth0PasswordChannel extends Auth0PasswordChannel {
  static create(outcome: Auth0PasswordChangeOutcome): MemoryAuth0PasswordChannel {
    return new MemoryAuth0PasswordChannel(outcome);
  }

  readonly requests: Auth0PasswordChangeRequest[] = [];

  private constructor(private readonly outcome: Auth0PasswordChangeOutcome) {
    super();
  }

  async changePassword(input: Auth0PasswordChangeRequest): Promise<Auth0PasswordChangeOutcome> {
    this.requests.push(input);
    return this.outcome;
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
