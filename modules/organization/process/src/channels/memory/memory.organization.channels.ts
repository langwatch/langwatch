import type { SlackNoticeMessage } from "@langwatch/internal-slack";

import type { OrganizationChannels } from "../organization.channels.ts";
import { SignupAnnouncementChannel } from "../signup-announcement.channel.ts";
import { MemoryOrganizationInviteMailChannel } from "./memory.organization-invite-mail.channel.ts";

/** Sign-up announcements and invites are recorded in-process for a test to read back. */
export class MemoryOrganizationChannels {
  static readonly requires = [] as const;

  static create(): OrganizationChannels {
    return {
      signupAnnouncements: MemorySignupAnnouncementChannel.create(),
      inviteMail: MemoryOrganizationInviteMailChannel.create(),
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
