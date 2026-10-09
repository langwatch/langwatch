import type { MailSender } from "@langwatch/mail";
import { NotificationService } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";
import type { RedisConnection } from "@langwatch/redis-client";
import { internalSlackSignupsWebhook, type ScopedSecrets } from "@langwatch/secrets";

import type { AuthChannels } from "../auth.channels.ts";
import { SesPasswordResetMailChannel } from "../ses/ses.password-reset-mail.channel.ts";
import { SesSignUpVerificationMailChannel } from "../ses/ses.sign-up-verification-mail.channel.ts";
import { SlackSignupAnnouncementChannel } from "../slack/slack.signup-announcement.channel.ts";
import { RedisCliDeviceSettlementChannel } from "./redis.cli-device-settlement.channel.ts";

/** Settlements over Redis pub/sub, sign-ups to our Slack, every mail through notification. */
export class RedisAuthChannels {
  static readonly requires = ["redis"] as const;
  static readonly binds = { notifications: NotificationService } as const;

  static async create({
    redis,
    secrets,
    bound,
  }: {
    redis: RedisConnection;
    secrets: ScopedSecrets;
    bound: BoundApis<typeof RedisAuthChannels.binds>;
  }): Promise<AuthChannels> {
    const mailer: MailSender = { send: (content) => bound.notifications.sendEmail(content) };
    const signupAnnouncements = await secrets.into(internalSlackSignupsWebhook, (webhookUrl) =>
      webhookUrl ? SlackSignupAnnouncementChannel.create({ webhookUrl }) : undefined,
    );
    return {
      cliSettlements: RedisCliDeviceSettlementChannel.create(redis),
      signupAnnouncements,
      passwordResetMail: SesPasswordResetMailChannel.create({ mailer }),
      signUpVerificationMail: SesSignUpVerificationMailChannel.create({ mailer }),
    };
  }
}
