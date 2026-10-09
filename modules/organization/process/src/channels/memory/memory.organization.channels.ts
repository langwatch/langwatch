import type { OrganizationChannels } from "../organization.channels.ts";
import { MemoryOrganizationInviteMailChannel } from "./memory.organization-invite-mail.channel.ts";
import { MemorySignupAnnouncementChannel } from "./memory.signup-announcement.channel.ts";

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
