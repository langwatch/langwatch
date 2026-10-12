import type { OrganizationInviteMailChannel } from "./organization-invite-mail.channel.ts";
import type { SignupAnnouncementChannel } from "./signup-announcement.channel.ts";

/** Every channel organization holds; sign-up announcements are absent without the Slack webhook. */
export interface OrganizationChannels {
  readonly signupAnnouncements: SignupAnnouncementChannel | undefined;
  readonly inviteMail: OrganizationInviteMailChannel;
}
