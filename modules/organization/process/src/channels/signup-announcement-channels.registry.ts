import { MemorySignupAnnouncementChannel } from "./memory/memory.signup-announcement.channel.ts";
import { SlackSignupAnnouncementChannel } from "./slack/slack.signup-announcement.channel.ts";

export const signupAnnouncementChannels = {
  live: SlackSignupAnnouncementChannel,
  memory: MemorySignupAnnouncementChannel,
};
