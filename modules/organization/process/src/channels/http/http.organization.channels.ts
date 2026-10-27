import { NotificationService } from "@langwatch/notification-contract";
import type { BoundApis } from "@langwatch/process";
import { internalSlackSignupsWebhook, type ScopedSecrets } from "@langwatch/secrets";

import type { OrganizationChannels } from "../organization.channels.ts";
import { SesOrganizationInviteMailChannel } from "../ses/ses.organization-invite-mail.channel.ts";
import { SlackSignupAnnouncementChannel } from "../slack/slack.signup-announcement.channel.ts";

/** Sign-ups go to our Slack when the webhook is set; invites go out through notification (§5). */
export class HttpOrganizationChannels {
  static readonly requires = [] as const;
  static readonly binds = { notifications: NotificationService } as const;

  static async create({
    secrets,
    bound,
  }: {
    secrets: ScopedSecrets;
    bound: BoundApis<typeof HttpOrganizationChannels.binds>;
  }): Promise<OrganizationChannels> {
    const signupAnnouncements = await secrets.into(internalSlackSignupsWebhook, (webhookUrl) =>
      webhookUrl ? SlackSignupAnnouncementChannel.create({ webhookUrl }) : undefined,
    );
    return {
      signupAnnouncements,
      inviteMail: SesOrganizationInviteMailChannel.create({ notifications: bound.notifications }),
    };
  }
}
